import BN from "../utils/BN";
import { IToken, TOKENS_BY_ASSET_ID, TOKENS_BY_SYMBOL } from "../constants";
import nodeService from "./nodeService";
import { getStateByKey } from "../utils/getStateByKey";
import { ADDRESS } from "../config";

export type TPoolToken = {
  cf: BN;
  lt: BN;
  penalty: BN;
  interest: BN;
} & IToken;

const calcApy = (i: BN) => {
  if (!i || i.isNaN()) return BN.ZERO;

  return i.plus(1).pow(365).minus(1).times(100).toDecimalPlaces(2);
};

const calcAutostakeApy = (
  totalSupply: BN,
  interest: BN,
  ASpreLastEarned: BN,
  ASlastEarned: BN,
  ASpreLastBlock: BN,
  ASlastBlock: BN
) => {
  if (!interest || interest.isNaN()) return BN.ZERO;
  const lastBlockStakingRewards = ASlastEarned.minus(ASpreLastEarned).div(
    ASlastBlock.minus(ASpreLastBlock)
  );
  const fStaked = lastBlockStakingRewards
    .div(totalSupply)
    .times(60)
    .times(24)
    .times(0.8);
  return fStaked.plus(interest).plus(1).pow(365).minus(1).times(100);
};

class PuzzlePoolStateFetchService {
  constructor() {}

  static fetchSetups = async (pool: string): Promise<TPoolToken[]> => {
    const settingKeys = [
      "setup_tokens",
      "setup_ltvs",
      "setup_lts",
      "setup_penalties",
      "setup_interest",
      "setup_active",
    ];

    const settings = await nodeService.nodeKeysRequest(pool, settingKeys);

    const splitRecord = (rec?: string | number) =>
      rec ? String(rec).split(",") : null;

    const tokens = splitRecord(getStateByKey(settings, "setup_tokens"));
    const ltvs = splitRecord(getStateByKey(settings, "setup_ltvs")); //cf
    const lts = splitRecord(getStateByKey(settings, "setup_lts")); //lt
    const penalties = splitRecord(getStateByKey(settings, "setup_penalties"));
    const interest = splitRecord(getStateByKey(settings, "setup_interest"));
    const active = getStateByKey(settings, "setup_active");
    if (tokens == null || !active) throw new Error("pool not active");
    return tokens.map((assetId, index) => {
      const asset = TOKENS_BY_ASSET_ID[assetId];
      return {
        ...asset,
        cf: ltvs && ltvs[index] ? new BN(ltvs![index]).div(1e8) : BN.ZERO,
        lt: lts && lts[index] ? new BN(lts![index]).div(1e8) : BN.ZERO,
        penalty:
          penalties && penalties[index]
            ? new BN(penalties![index]).div(1e8)
            : BN.ZERO,
        interest:
          interest && interest[index]
            ? new BN(interest![index]).div(1e8)
            : BN.ZERO,
      };
    });
  };

  static getPrices = async (pool: string) => {
    const response = await nodeService.evaluate(pool, "getPrices(false)");
    const value = response?.result?.value?._2?.value as string;

    if (!value) return null;

    return value
      .split("|")
      .filter((str: string) => str !== "")
      .map((str: string) => {
        const [min, max] = str.split(",");
        return { min: BN.formatUnits(min, 6), max: BN.formatUnits(max, 6) };
      });
  };
  static getUserCollateral = async (
    pool: string,
    userId?: string
  ): Promise<any> => {
    const response = await nodeService.evaluate(
      pool,
      `getUserCollateral(false, "${userId}", true, "")`
    );

    const userCollateral = response?.result?.value?._2?.value;

    return userCollateral ?? 0;
  };

  static calculateTokenRates = async (pool: string) => {
    const response = await nodeService.evaluate(
      pool,
      "calculateTokenRates(false)"
    );
    const value = response?.result?.value?._2?.value as string;

    return value
      .split(",")
      .filter((v) => v !== "")
      .map((v) => {
        const [borrowRate, supplyRate] = v.split("|");
        return {
          borrowRate: BN.formatUnits(borrowRate, 16),
          supplyRate: BN.formatUnits(supplyRate, 16),
        };
      });
  };
  static calculateTokensInterest = async (pool: string) => {
    const response = await nodeService.evaluate(
      pool,
      "calculateTokensInterest(false)"
    );
    const value = response?.result?.value?._2?.value as string;

    return value
      .split(",")
      .filter((v) => v !== "")
      .map((v) => BN.formatUnits(v, 8));
  };

  static fetchPoolsStats = async (pool: string) => {
    const tokensSetups = await PuzzlePoolStateFetchService.fetchSetups(pool);
    const keys = tokensSetups.reduce(
      (acc, { assetId }) => [
        ...acc,
        `setup_maxSupply_${assetId}`,
        `total_supplied_${assetId}`,
        `total_borrowed_${assetId}`,
        `autostake_preLastEarned_${assetId}`,
        `autostake_lastEarned_${assetId}`,
        `autostake_preLastBlock_${assetId}`,
        `autostake_lastBlock_${assetId}`,
        ...(ADDRESS
          ? [`${ADDRESS}_supplied_${assetId}`, `${ADDRESS}_borrowed_${assetId}`]
          : []),
      ],
      [] as string[]
    );

    const [state, rates, prices, interests] = await Promise.all([
      nodeService.nodeKeysRequest(pool, keys),
      PuzzlePoolStateFetchService.calculateTokenRates(pool),
      PuzzlePoolStateFetchService.getPrices(pool),
      PuzzlePoolStateFetchService.calculateTokensInterest(pool),
    ]);

    return tokensSetups.map((token, index) => {
      const sup = getStateByKey(state, `total_supplied_${token.assetId}`);
      const totalSupply = new BN(sup ?? "0").times(rates[index].supplyRate);

      const sSup = getStateByKey(state, `${ADDRESS}_supplied_${token.assetId}`);
      const selfSupply = new BN(sSup ?? "0").times(rates[index].supplyRate);

      const bor = getStateByKey(state, `total_borrowed_${token.assetId}`);
      const totalBorrow = new BN(bor ?? "0").times(rates[index].borrowRate);

      const sBor = getStateByKey(state, `${ADDRESS}_borrowed_${token.assetId}`);
      const selfBorrow = new BN(sBor ?? "0").times(rates[index].borrowRate);

      const UR = totalBorrow.div(totalSupply);
      const supplyInterest = interests[index].times(UR).times(0.8);

      const p = prices ? prices[index] : { min: BN.ZERO, max: BN.ZERO };
      const dailyIncome = selfSupply.times(supplyInterest);
      const dailyLoan = selfBorrow.times(interests[index]);

      const limit = getStateByKey(state, `setup_maxSupply_${token.assetId}`);
      const assetMaxSupply = BN.formatUnits(
        limit ?? "0",
        TOKENS_BY_SYMBOL.USDN.decimals
      );

      const ASpreLastEarnedNum = getStateByKey(
        state,
        `autostake_preLastEarned_${token.assetId}`
      );
      const ASpreLastEarned = new BN(ASpreLastEarnedNum ?? 0);
      const ASlastEarnedNum = getStateByKey(
        state,
        `autostake_lastEarned_${token.assetId}`
      );
      const ASlastEarned = new BN(ASlastEarnedNum ?? 0);
      const ASpreLastBlockNum = getStateByKey(
        state,
        `autostake_preLastBlock_${token.assetId}`
      );
      const ASpreLastBlock = new BN(ASpreLastBlockNum ?? 0);
      const ASlastBlockNum = getStateByKey(
        state,
        `autostake_lastBlock_${token.assetId}`
      );
      const ASlastBlock = new BN(ASlastBlockNum ?? 0);

      return {
        ...token,
        interest: interests[index],
        prices: p,
        supplyLimit: assetMaxSupply,
        dailyIncome: dailyIncome.toDecimalPlaces(0),
        dailyLoan: dailyLoan.toDecimalPlaces(0),
        totalSupply: totalSupply.toDecimalPlaces(0),
        selfSupply: selfSupply.toDecimalPlaces(0),
        totalBorrow: totalBorrow.toDecimalPlaces(0),
        selfBorrow: selfBorrow.toDecimalPlaces(0),
        supplyAPY: ASlastBlockNum
          ? calcAutostakeApy(
              totalSupply,
              supplyInterest,
              ASpreLastEarned,
              ASlastEarned,
              ASpreLastBlock,
              ASlastBlock
            )
          : calcApy(supplyInterest),
        isAutostakeAvl: !!ASlastBlockNum,
        borrowAPY: calcApy(interests[index]),
      };
    });
  };
}

export default PuzzlePoolStateFetchService;
