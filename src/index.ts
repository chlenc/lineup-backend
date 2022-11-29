import TelegramService from "./services/telegramService";
import PuzzlePoolStateFetchService from "./services/puzzlePoolStateFetchService";
import BN from "./utils/BN";
import nodeService from "./services/nodeService";
import { DAPP, EXPLORER_URL } from "./constants";
import blockchainService from "./services/blockchainService";
import { SEED } from "./config";
import cron from "node-cron";

const { groupMessage } = new TelegramService();

const puzzlePools = [
  "3P4DK5VzDwL3vfc5ahUEhtoe5ByZNyacJ3X",
  "3P4uA5etnZi4AmBabKinq2bMiWU8KcnHZdH",
];
let assetId = "DG2xFkPdDwKUoBkzGAhQtLpSGzfXLiCYPEzeKH2Ad24p";

cron.schedule("* * * * *", async () => {
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
      const options = {
        functionName: "rebalance",
        args: [{ type: "string", value: maxYieldPool }] as any,
        dApp: DAPP,
        seed: SEED,
      };
      const tx = await blockchainService.invoke(options);
      const lastApy =
        apys[puzzlePools.indexOf(currentPool.value)]
          .find((s) => s.assetId === assetId)
          ?.supplyAPY.toFormat(2) ?? "";
      const newApy =
        apys[puzzlePools.indexOf(maxYieldPool)]
          .find((s) => s.assetId === assetId)
          ?.supplyAPY.toFormat(2) ?? "";

      const msg = `♻️ The funds were moved to a more profitable pool: ${maxYieldPool}\n\nRebalance TX: ${EXPLORER_URL}/tx/${tx.id}\n\nApy: ${lastApy}% ➡️ ${newApy}%`;
      await groupMessage(msg);
    } catch (e) {
      console.log(e);
    }
  }
});

process.stdout.write("Bot has been started ✅  \n");
