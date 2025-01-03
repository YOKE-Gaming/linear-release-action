import { LinearClient } from "@linear/sdk";
import {
  getVersion,
  getRepoName,
  getDoneStatus,
  updateIssues,
  sendToSlack,
  compileChangelog,
  getInput,
  createVersionLabel,
} from "./utils";
import * as core from "@actions/core";
import { WebClient } from "@slack/web-api";

import * as dotenv from "dotenv";

// Used for local development
dotenv.config({ path: ".env.local" });

export async function run() {
  core.info("Starting release action...");
  try {
    // Get inputs from action
    const apiKey = getInput("linearApiKey");
    const slackToken = getInput("slackToken");
    const slackChannel = getInput("slackChannel");
    const appName = getInput("appName");

    // Initialize clients
    const client = new LinearClient({ apiKey });
    const slackClient = new WebClient(slackToken);

    // Get version and repo name
    const version = getVersion(appName);
    const repoName = getRepoName();

    const versionLabel = await createVersionLabel({client, version, repoName});
    const doneStatus = await getDoneStatus(client);

    const issues = await updateIssues(client, {
      versionLabel,
      repoName,
      stateId: doneStatus.id,
    });

    const changelog = await compileChangelog({ appName, issues, repoName, version });
    core.info(`Changelog:\n${changelog}`);
    core.info(`Sending to Slack...`);
    await sendToSlack(slackClient, slackChannel, changelog);

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
