const { merge } = require("lodash")
const settings = require("../witnet.settings")
const utils = require("../../scripts/utils")

module.exports = async function (deployer, network, accounts) {
  const realm = network === "test"
    ? "default"
    : utils.getRealmNetworkFromArgs()[0]

  const addresses = require("../witnet.addresses")[realm][network = network.split("-")[0]]
  const artifactsName = merge(settings.artifacts.default, settings.artifacts[realm])

  let WitnetParserLib, WitnetDecoderLib
  let WitnetProxy, WitnetRequestBoard
  let upgradeProxy = false

  /* Load the 'WitnetProxy' artifact only if neccesary, and deploy it if not done yet */
  try {
    WitnetProxy = artifacts.require(artifactsName.WitnetProxy)
    if (!WitnetProxy.isDeployed() || WitnetProxy.address !== addresses.WitnetRequestBoard) {
      // If the 'WitnetProxy' artifact is found, we assume that the
      // target 'WitnetRequestBoard' implementation is proxiable. In this case,
      // the 'WitnetProxy' actual address will be read from the one assigned to the
      // 'WitnetRequestBoard' artifact in the addresses file:
      if (addresses) WitnetProxy.address = addresses.WitnetRequestBoard
    }
    if (!WitnetProxy.isDeployed() || utils.isNullAddress(WitnetProxy.address)) {
      await deployer.deploy(WitnetProxy)
    } else {
      console.log(`\n   Skipped: '${artifactsName.WitnetProxy}' deployed at ${WitnetProxy.address}.`)
    }
    upgradeProxy = true
  } catch {
    // If no 'WitnetProxy' artifact is found, we assume that
    // the target 'WitnetRequestBoard' implementation is not proxiable.
  }

  /* Load target 'WitnetRequestBoard' implementation artifact */
  try {
    WitnetRequestBoard = artifacts.require(artifactsName.WitnetRequestBoard)
  } catch {
    console.log(`\n   Skipped: '${artifactsName.WitnetRequestBoard}' artifact not found.`)
    return
  }

  if (!upgradeProxy) {
    if (!WitnetRequestBoard.isDeployed() || utils.isNullAddress(WitnetRequestBoard.address)) {
      // Read implementation address from file only if the implementation requires no proxy
      if (addresses) WitnetRequestBoard.address = addresses.WitnetRequestBoard
    }
  }

  /* Try to find 'WitnetParserLib' artifact, and deployed address if any */
  try {
    WitnetParserLib = artifacts.require(artifactsName.WitnetParserLib)
    if (!WitnetParserLib.isDeployed() || WitnetParserLib.address !== addresses.WitnetParserLib) {
      // If the 'WitnetParserLib' is found, try to read deployed address from addresses file:
      if (addresses) WitnetParserLib.address = addresses.WitnetParserLib
    }
  } catch {
    console.error(`\n   Fatal: '${artifactsName.WitnetParserLib}' artifact not found.\n`)
    process.exit(1)
  }

  /* Deploy new instance of 'WitnetParserLib', and 'WitnetDecoderLib', if neccesary */
  if (!WitnetParserLib.isDeployed() || utils.isNullAddress(WitnetParserLib.address)) {
    // Fetch the 'WitnetDecoderLib' artifact:
    try {
      WitnetDecoderLib = artifacts.require(artifactsName.WitnetDecoderLib)
    } catch {
      console.error(`\n   Fatal: '${artifactsName.WitnetDecoderLib}' artifact not found.\n`)
      process.exit(1)
    }
    // Deploy the 'WitnetDecoderLib' artifact first, if not done yet:
    if (!WitnetDecoderLib.isDeployed()) {
      await deployer.deploy(WitnetDecoderLib)
      // and link the just-deployed 'WitnetDecoderLib' to the 'WitnetParserLib' artifact:
      await deployer.link(WitnetDecoderLib, WitnetParserLib)
    }
    await deployer.deploy(WitnetParserLib)
  } else {
    console.log(`\n   Skipped: '${artifactsName.WitnetParserLib}' deployed at ${WitnetParserLib.address}.`)
  }

  /* Deploy new instance of target 'WitnetRequestBoard' implementation */
  if (upgradeProxy && network !== "test") {
    // But ask operator first, if this was a proxiable implementation:
    // eslint-disable-next-line no-undef
    const answer = await utils.prompt("\n   > Do you wish to upgrade the proxy ? [y/N] ")
    if (!["y", "yes"].includes(answer.toLowerCase().trim())) {
      upgradeProxy = false
      return
    }
  }

  await deployer.link(WitnetParserLib, WitnetRequestBoard)
  await deployer.deploy(
    WitnetRequestBoard,
    ...(
      settings.constructorParams[network] && settings.constructorParams[network].WitnetRequestBoard
      // if defined, use network-specific constructor parameters:
        ? settings.constructorParams[network].WitnetRequestBoard
        : settings.constructorParams[realm] && settings.constructorParams[realm].WitnetRequestBoard
        // otherwise, use realm-specific parameters, if any:
          ? settings.constructorParams[realm].WitnetRequestBoard
          : settings.constructorParams.default && settings.constructorParams.default.WitnetRequestBoard
          // or, default defined parameters for WRBs, if any:
            ? settings.constructorParams.default.WitnetRequestBoard
            : null
    )
  )

  /* Upgrade 'WitnetProxy' instance, if neccesary */
  if (upgradeProxy) {
    const proxy = await WitnetProxy.deployed()
    const wrb = await WitnetRequestBoard.deployed()

    const oldAddr = await proxy.implementation.call()
    let oldCodehash, oldVersion
    if (!utils.isNullAddress(oldAddr)) {
      const oldWrb = await WitnetRequestBoard.at(oldAddr)
      oldCodehash = await oldWrb.codehash.call()
      oldVersion = await oldWrb.version.call()
    }
    console.log(`   Upgrading '${artifactsName.WitnetProxy}' instance at ${WitnetProxy.address}:\n`)
    await proxy.upgradeTo(
      WitnetRequestBoard.address,
      web3.eth.abi.encodeParameter(
        "address[]",
        [accounts[0]]
      )
    )
    console.log(`   >> WRB owner address:  ${await wrb.owner.call()}`)
    if (utils.isNullAddress(oldAddr)) {
      console.log(`   >> WRB address:        ${await proxy.implementation.call()}`)
      console.log(`   >> WRB proxiableUUID:  ${await wrb.proxiableUUID.call()}`)
      console.log(`   >> WRB codehash:       ${await wrb.codehash.call()}`)
      console.log(`   >> WRB version tag:    ${web3.utils.hexToString(await wrb.version.call())}`)
    } else {
      console.log(`   >> WRB addresses:      ${oldAddr} => ${await proxy.implementation.call()}`)
      console.log(`   >> WRB proxiableUUID:  ${await wrb.proxiableUUID.call()}`)
      console.log(`   >> WRB codehashes:     ${oldCodehash} => ${await wrb.codehash.call()}`)
      console.log(
        `   >> WRB version tags:   '${web3.utils.hexToString(oldVersion)}'`,
        `=> '${web3.utils.hexToString(await wrb.version.call())}'`
      )
    }
    console.log(`   >> WRB soft-upgradable:${await wrb.isUpgradable.call()}\n`)
  } else {
    console.log(`\n   Skipped: '${artifactsName.WitnetRequestBoard}' deployed at ${WitnetRequestBoard.address}.`)
  }
}
