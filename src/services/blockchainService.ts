import { broadcast, invokeScript, waitForTx } from "@waves/waves-transactions";
import { WithId } from "@waves/waves-transactions/src/transactions";
import {
  InvokeScriptCallArgument,
  InvokeScriptTransaction,
} from "@waves/ts-types";
import nodeService, { mainnetNodes } from "./nodeService";

export type TPayments = { assetId?: string | null; amount: string | number };

interface IInvokeParams {
  seed: string;
  dApp: string;
  functionName: string;
  args?: InvokeScriptCallArgument<string | number>[];
  payment?: TPayments[];
  fee?: number;
  feeAssetId?: string;
}

class BlockchainService {
  public invoke = async (
    params: IInvokeParams
  ): Promise<InvokeScriptTransaction<string | number> & WithId> => {
    const tx = invokeScript(
      {
        chainId: "W",
        dApp: params.dApp,
        call: { function: params.functionName, args: params.args ?? [] },
        payment: params.payment,
        fee: params.fee,
        feeAssetId: params.feeAssetId,
      },
      params.seed
    );
    await broadcast(tx, mainnetNodes[0]);
    await waitForTx(tx.id, { apiBase: mainnetNodes[0] });
    return tx;
  };
  getWavesBalance = async (address: string) => {
    const req = `/addresses/balance/${address}`;
    const { data } = await nodeService.request(req);
    return data.balance;
  };
  getAssetBalance = async (
    address: string,
    assetId: string
  ): Promise<number> => {
    if (assetId === "WAVES") return await this.getWavesBalance(address);
    else {
      const req = `/assets/balance/${address}/${assetId}`;
      const { data } = await nodeService.request(req);
      return data.balance;
    }
  };
  getAssetDetails = async (assetId: string): Promise<{ decimals: number }> => {
    const req = `/assets/details/${assetId}`;
    const { data } = await nodeService.request(req);
    return data;
  };
}

export default new BlockchainService();
