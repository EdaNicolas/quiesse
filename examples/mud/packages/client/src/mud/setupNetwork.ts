import { defineContractComponents } from './contractComponents'
import { getNetworkConfig } from './getNetworkConfig'
import { world } from './world'
import { JsonRpcProvider } from '@ethersproject/providers'
import {
	createFastTxExecutor,
	createFaucetService,
	getSnapSyncRecords,
} from '@latticexyz/network'
import { setupMUDV2Network } from '@latticexyz/std-client'
import { getTableIds } from '@latticexyz/utils'
import storeConfig from 'contracts/mud.config'
import { IWorld } from 'contracts/src/codegen/world/IWorld.sol'
import { Contract, Signer, utils } from 'ethers'
import { Interface } from 'ethers/lib/utils'

export type SetupNetworkResult = Awaited<ReturnType<typeof setupNetwork>>

export async function setupNetwork() {
	const contractComponents = defineContractComponents(world)
	const networkConfig = await getNetworkConfig()
	const result = await setupMUDV2Network<
		typeof contractComponents,
		typeof storeConfig
	>({
		networkConfig,
		world,
		contractComponents,
		syncThread: 'main',
		storeConfig,
		worldAbi: IWorld.abi,
	})

	// Request drip from faucet
	const signer = result.network.signer.get()
	if (networkConfig.faucetServiceUrl && signer) {
		const address = await signer.getAddress()
		console.info('[Dev Faucet]: Player address -> ', address)

		const faucet = createFaucetService(networkConfig.faucetServiceUrl)

		const requestDrip = async () => {
			const balance = await signer.getBalance()
			console.info(`[Dev Faucet]: Player balance -> ${balance}`)
			const lowBalance = balance?.lte(utils.parseEther('1'))
			if (lowBalance) {
				console.info('[Dev Faucet]: Balance is low, dripping funds to player')
				// Double drip
				await faucet.dripDev({ address })
				await faucet.dripDev({ address })
			}
		}

		requestDrip()
		// Request a drip every 20 seconds
		setInterval(requestDrip, 20000)
	}

	const provider = result.network.providers.get().json
	const signerOrProvider = signer ?? provider
	// Create a World contract instance
	// TODO convert this to viem
	const worldContract = new Contract(
		networkConfig.worldAddress,
		new Interface(IWorld.abi),
		signerOrProvider,
	)

	if (networkConfig.snapSync) {
		const currentBlockNumber = await provider.getBlockNumber()
		const tableRecords = await getSnapSyncRecords(
			networkConfig.worldAddress,
			getTableIds(storeConfig),
			currentBlockNumber,
			signerOrProvider,
		)

		console.log(`Syncing ${tableRecords.length} records`)
		result.startSync(tableRecords, currentBlockNumber)
	} else {
		result.startSync()
	}

	// Create a fast tx executor
	const fastTxExecutor =
		signer?.provider instanceof JsonRpcProvider
			? await createFastTxExecutor(
					signer as Signer & { provider: JsonRpcProvider },
			  )
			: null

	// TODO: infer this from fastTxExecute signature?
	type BoundFastTxExecuteFn<C extends Contract> = <F extends keyof C>(
		func: F,
		args: Parameters<C[F]>,
		options?: {
			retryCount?: number
		},
	) => Promise<ReturnType<C[F]>>

	function bindFastTxExecute<C extends Contract>(
		contract: C,
	): BoundFastTxExecuteFn<C> {
		return async function (...args) {
			if (!fastTxExecutor) {
				throw new Error('no signer')
			}
			const { tx } = await fastTxExecutor.fastTxExecute(contract, ...args)
			return await tx
		}
	}

	return {
		...result,
		worldContract,
		worldSend: bindFastTxExecute(worldContract),
		fastTxExecutor,
	}
}
