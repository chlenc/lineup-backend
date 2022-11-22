import TelegramService from "./services/telegramService";
import { sleep } from "./utils/utils";
import PuzzlePoolStateFetchService from "./services/puzzlePoolStateFetchService";
import BN from "./utils/BN";
import nodeService from "./services/nodeService";
import { DAPP, EXPLORER_URL } from "./constants";
import blockchainService from "./services/blockchainService";
import { SEED } from "./config";
import { InvokeScriptCallArgument } from "@waves/ts-types";
const { groupMessage } = new TelegramService();

const puzzlePools = [
  "3P4DK5VzDwL3vfc5ahUEhtoe5ByZNyacJ3X",
  "3P4uA5etnZi4AmBabKinq2bMiWU8KcnHZdH",
];
let assetId = "DG2xFkPdDwKUoBkzGAhQtLpSGzfXLiCYPEzeKH2Ad24p";
(async () => {
  while (true) {
    const req = `/addresses/data/${DAPP}/currentPool`;
    const { data: currentPool } = await nodeService.request(req);
    const apys = await Promise.all(
      puzzlePools.map(PuzzlePoolStateFetchService.fetchPoolsStats)
    );
    const maxYieldPool = apys.reduce((acc, stats, i) => {
      const tokenStat = stats.find((s) => s.assetId === assetId);
      return tokenStat == null || tokenStat.supplyAPY.lte(acc ?? BN.ZERO)
        ? acc
        : (puzzlePools[i] as string);
    }, null as string | null);

    if (maxYieldPool != null && maxYieldPool !== currentPool.value) {
      try {
        const optionsBase = { dApp: DAPP, seed: SEED };
        const withdrawOptions = { functionName: "withdraw", ...optionsBase };
        const withdrawTx = await blockchainService.invoke(withdrawOptions);
        const supplyOptions = {
          functionName: "supply",
          args: [
            { type: "string", value: maxYieldPool },
          ] as InvokeScriptCallArgument<string | number>[],
          ...optionsBase,
        };
        const supplyTx = await blockchainService.invoke(supplyOptions);
        const lastApy =
          apys[puzzlePools.indexOf(currentPool.value)]
            .find((s) => s.assetId === assetId)
            ?.supplyAPY.toFormat(2) ?? "";
        const newApy =
          apys[puzzlePools.indexOf(maxYieldPool)]
            .find((s) => s.assetId === assetId)
            ?.supplyAPY.toFormat(2) ?? "";

        const msg = `♻️ The funds were moved to a more profitable pool: ${maxYieldPool}\n\nWithdraw TX: ${EXPLORER_URL}/tx/${withdrawTx.id}\n\nSupply TX: ${EXPLORER_URL}/tx/${supplyTx.id}\n\nApy: ${lastApy}% ➡️ ${newApy}%`;
        await groupMessage(msg);
      } catch (e) {
        console.log(e);
      }
    }

    await sleep(60 * 1000);
  }
})();

process.stdout.write("Bot has been started ✅  \n");
