// SPDX-License-Identifier: MIT

pragma solidity >=0.7.0 <0.9.0;

import "../libs/WitnetData.sol";

/**
 * @title Witnet Board basal data model. 
 * @author Witnet Foundation
 */
abstract contract WitnetBoardData {  

  struct SWitnetBoardData {
    address owner;
    address base;
    mapping (uint => SWitnetBoardDataRequest) requests;
    uint256 numRequests;
  }

  struct SWitnetBoardDataRequest {
    WitnetTypes.DataRequest dr;
    bytes result;
  }

  constructor() {
    __data().owner = msg.sender;
  }

  modifier notDestroyed(uint256 id) {
    require(id > 0 && id <= __data().numRequests, "WitnetBoardData: not yet posted");
    require(__dataRequest(id).requestor != address(0), "WitnetBoardData: destroyed");
    _;
  }

  modifier onlyOwner {
    require(msg.sender == __data().owner, "WitnetBoardData: only owner");
    _;    
  }

  modifier resultNotYetReported(uint256 id) {
    require(__dataRequest(id).txhash == 0, "WitnetBoardData: already solved");
    _;
  }

  modifier wasPosted(uint256 id) {
    require(id > 0 && id <= __data().numRequests, "WitnetBoardData: not yet posted");
    _;
  }

  function __data() internal pure returns (SWitnetBoardData storage _struct) {
    assembly {
      _struct.slot := WITNET_BOARD_DATA_SLOTHASH
    }
  }

  function __dataRequest(uint256 id) internal view returns (WitnetTypes.DataRequest storage) {
    return __data().requests[id].dr;
  }
  
  bytes32 internal constant WITNET_BOARD_DATA_SLOTHASH = "WitnetBoard.Data";  

}
