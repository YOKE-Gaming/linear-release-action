import { getInput } from "@actions/core";
import { LinearClient } from "@linear/sdk";
import { getVersion, getRepoName, createLabel, getDoneStatus, updateIssues } from "./utils";
import * as core from "@actions/core";

export async function run() {
  try {
    const apiKey = getInput("linearApiKey");
    const client = new LinearClient({ apiKey });

    const version = getVersion();
    const repoName = getRepoName();

    const versionLabel = await createLabel(client, version, repoName);
    const doneStatus = await getDoneStatus(client);

    await updateIssues(client, {
      versionLabel,
      repoName,
      stateId: doneStatus.id,
    });
    core.info("Done.");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed: ${error.message}`);
    } else {
      core.setFailed(`Action failed: ${error}`);
    }
  }
}

run();
