import { getNoraState } from "./NoraController.mjs";
import { notifyStateChanged } from "./StateController.mjs";
import { saveNoraDefinition } from "../registry/Nora.mjs";
import { listModels } from "../runtime/NoraProcess.mjs";

const requestError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const setNoraModel = async payload => {
  const provider = typeof payload.provider === "string" ? payload.provider.trim() : "";
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (!provider || !model) throw requestError("Provider and model are required");

  const providerEntry = listModels().find(item => item.provider === provider);
  if (!providerEntry || !providerEntry.models?.includes(model)) {
    throw requestError(`Unknown model selection: ${provider}/${model}`);
  }

  await saveNoraDefinition({ provider, model });
  notifyStateChanged(["nora", "models"]);
  return getNoraState();
};
