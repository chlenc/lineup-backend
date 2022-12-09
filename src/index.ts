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

const rebalance = async () => {
  const req = `/addresses/data/${DAPP}/currentPool`;
  const { data: currentPool } = await nodeService.request(req);
  const apys = await Promise.all(
    puzzlePools.map(PuzzlePoolStateFetchService.fetchPoolsStats)
  );
  const { address: maxYieldPool, apy: maxYieldPoolApy } = apys.reduce(
    ({ address, apy }, stats, i) => {
      const tokenStat = stats.find((s) => s.assetId === assetId);
      return tokenStat == null || tokenStat.supplyAPY.lte(apy)
        ? { address, apy }
        : { address: puzzlePools[i], apy: tokenStat.supplyAPY };
    },
    { address: null, apy: BN.ZERO } as { address: string | null; apy: BN }
  );
  // console.log({
  //   maxYieldPool: maxYieldPool,
  //   currentPool: currentPool.value,
  // });
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
      const newApy = maxYieldPoolApy.toFormat(2) ?? "";

      const msg = `♻️ The funds were moved to a more profitable pool: ${maxYieldPool}\n\nRebalance TX: ${EXPLORER_URL}/tx/${tx.id}\n\nApy: ${lastApy}% ➡️ ${newApy}%`;
      await groupMessage(msg);
    } catch (e) {
      console.log(e);
    }
  }
};

(async () => {
  while (true) {
    await rebalance();
    await new Promise((r) => setTimeout(r, 60000));
  }
})();

// cron.schedule("* * * * *", rebalance);

process.stdout.write("Bot has been started ✅  \n");
