import { INodeData } from "../services/nodeService";

export const getStateByKey = (values: INodeData[], key: string) =>
  values.find((state) => state.key === key)?.value;
