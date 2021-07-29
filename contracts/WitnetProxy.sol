// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

import "./utils/Upgradable.sol";

/** @title WitnetProxy: upgradable delegate-proxy contract that routes Witnet data requests coming from a 
 * `UsingWitnet`-inheriting contract to a currently active `WitnetRequestBoard` implementation. 
 *
 * https://github.com/witnet/witnet-ethereum-bridge/tree/0.3.x
 *
 * Written in 2021 by the Witnet Foundation.
 **/
contract WitnetProxy {
  struct WitnetProxyData {
    address implementation;
  }

  /// @dev Constructor with no params as to ease eventual support of Singleton pattern (i.e. ERC-2470)
  constructor () {}

  /// @dev WitnetProxies will never accept direct transfer of ETHs.
  receive() external payable {
    revert("WitnetProxy: no ETH accepted");
  }

  /// @dev Payable fallback accepts delegating calls to payable functions.  
  fallback() external payable { /* solhint-disable no-complex-fallback */
    address _implementation = implementation();

    assembly { /* solhint-disable avoid-low-level-calls */
      // Gas optimized delegate call to 'implementation' contract.
      // Note: `msg.data`, `msg.sender` and `msg.value` will be passed over 
      //       to actual implementation of `msg.sig` within `implementation` contract.
      let ptr := mload(0x40)
      calldatacopy(ptr, 0, calldatasize())
      let result := delegatecall(gas(), _implementation, ptr, calldatasize(), 0, 0)
      let size := returndatasize()
      returndatacopy(ptr, 0, size)
      switch result
        case 0  { 
          // pass back revert message:
          revert(ptr, size) 
        }
        default {
          // pass back same data as returned by 'implementation' contract:
          return(ptr, size) 
        }
    }
  }

  /// @dev Returns proxy's current implementation address.
  function implementation() public view returns (address) {
    return __proxySlot().implementation;
  }

  /// @dev Upgrades the `implementation` address.
  /// @param _newImplementation New implementation address.
  /// @param _initData Raw data with which new implementation will be initialized.
  /// @return Returns whether new implementation would be further upgradable, or not.
  function upgrade(address _newImplementation, bytes memory _initData)
    public returns (bool)
  {
    // New implementation cannot be null:
    require(_newImplementation != address(0), "WitnetProxy: null implementation");

    address _oldImplementation = implementation();
    if (_oldImplementation != address(0)) {
      // New implementation address must differ from current one:
      require(_newImplementation != _oldImplementation, "WitnetProxy: nothing to upgrade");

      // Assert whether current implementation is intrinsically upgradable:
      try Upgradable(_oldImplementation).isUpgradable() returns (bool _isUpgradable) {
        require(_isUpgradable, "WitnetProxy: not upgradable");
      } catch {
        revert("WitnetProxy: unable to check upgradability");
      }

      // Assert whether current implementation allows `msg.sender` to upgrade the proxy:
      (bool _wasCalled, bytes memory _result) = _oldImplementation.delegatecall(
        abi.encodeWithSignature(
          "isUpgradableFrom(address)",
          msg.sender
        )
      );
      require(_wasCalled, "WitnetProxy: not compliant");
      require(abi.decode(_result, (bool)), "WitnetProxy: not authorized");
    }

    // Initialize new implementation within proxy-context storage:
    (bool _wasInitialized,) = _newImplementation.delegatecall(
      abi.encodeWithSignature(
        "initialize(bytes)",
        _initData
      )
    );
    require(_wasInitialized, "WitnetProxy: unable to initialize");

    // If all checks and initialization pass, update implementation address:
    __proxySlot().implementation = _newImplementation;

    // Asserts new implementation complies w/ minimal implementation of Upgradable interface:
    try Upgradable(_newImplementation).isUpgradable() returns (bool _isUpgradable) {
      return _isUpgradable;
    }
    catch {
      revert ("WitnetProxy: not compliant");
    }
  }
}
