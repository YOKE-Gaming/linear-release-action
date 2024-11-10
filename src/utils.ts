import * as core from "@actions/core";
import { Issue, IssueLabel, LinearClient, WorkflowState } from "@linear/sdk";
import * as fs from "fs";
import { WebClient } from "@slack/web-api";

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

export function getVersion(): string {
  try {
    const appJson = JSON.parse(fs.readFileSync("app.json", "utf8"));
    if (appJson) {
      return `${appJson.expo.version}-${appJson.expo.extra.ota.version}`;
    }
  } catch {
    // no-op
  }

  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  return packageJson.version;
}

export function getRepoName(): string {
  return process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
}

export function getInput(name: string): string {
  return process.env[name] ?? core.getInput(name);
}

export async function createVersionLabel({
  client,
  version,
  repoName,
}: {
  client: LinearClient;
  version: string;
  repoName: string;
}): Promise<IssueLabel> {
  core.info(`Creating a new label for version: ${version}...`);
  const parentLabelNodes = await client.issueLabels({
    filter: {
      name: {
        in: [`Versions - ${repoName}`],
      },
    },
  });
  const parentLabel = parentLabelNodes.nodes[0];
  if (!parentLabel) {
    core.setFailed(
      `Parent label "Versions - ${repoName}" not found in Linear.`
    );
  }
  const parentId = parentLabel.id;
  const teamId = (await parentLabel.team)?.id;
  if (!teamId) {
    core.setFailed(`Team not found for label "Versions - ${repoName}"`);
  }

  // this will throw an error if the label already exists
  let versionLabel;
  try {
    const createdLabel = await client.createIssueLabel({
      name: version,
      color: parentLabel.color,
      teamId,
      parentId,
    });
    versionLabel = createdLabel.issueLabel;
    core.info(`Created label with name: ${version}`);
  } catch (error) {
    const versionLabelNodes = await client.issueLabels({
      filter: {
        name: {
          eq: version,
        },
        team: {
          id: {
            eq: teamId,
          },
        },
        parent: {
          id: {
            eq: parentId,
          },
        },
      },
    });
    versionLabel = versionLabelNodes.nodes[0];
    core.info(`Found label with name: ${version}`);
  }
  if (!versionLabel) {
    throw new Error(`Failed to create or find label ${version} in Linear.`);
  }
  return versionLabel;
}

export async function getDoneStatus(
  client: LinearClient
): Promise<WorkflowState> {
  const statusNodes = await client.workflowStates({
    filter: {
      name: {
        eq: "Done",
      },
    },
  });
  const doneStatus = statusNodes.nodes[0];
  if (!doneStatus) {
    core.setFailed("Done status not found in Linear.");
  }
  return doneStatus;
}

export async function updateIssues(
  client: LinearClient,
  {
    versionLabel,
    repoName,
    stateId,
  }: { versionLabel: IssueLabel; repoName: string; stateId: string }
) {
  core.info(`Finding "Ready For Release" issues in ${repoName}...`);
  const issuesToUpdate = await client.issues({
    filter: {
      labels: {
        name: {
          eq: repoName,
        },
      },
      state: {
        name: {
          eq: "Ready For Release",
        },
      },
    },
  });
  if (issuesToUpdate.nodes.length === 0) {
    throw new Error("No issues found to update.");
  }

  core.info(`Found ${issuesToUpdate.nodes.length} issues to update.`);
  for (const issue of issuesToUpdate.nodes) {
    core.info(`Updating issue ${issue.identifier}...`);
    try {
      await issue.update({
        stateId,
      });
      await client.issueAddLabel(issue.id, versionLabel.id);
      core.info(
        `Updated issue ${issue.identifier} with label ${versionLabel.name} and marked as Done.`
      );
    } catch (error) {
      core.warning(`Failed to update issue ${issue.identifier}: ${error}`);
    }
  }

  return issuesToUpdate.nodes;
}

export async function compileChangelog({
  issues,
  repoName,
  version,
}: {
  issues: Issue[];
  repoName: string;
  version: string;
}): Promise<string> {
  const changelog = [
    `*Release Notes: \`${repoName}-${version}\`* has been successfully released! :rocket:`,
    `*Release Date:* ${new Date().toLocaleDateString()}`,
    `*Total Issues:* ${issues.length}\n`,
    "Here's a summary of the completed issues:",
  ];

  for (const issue of issues) {
    try {
      const assignee = await issue.assignee;
      changelog.push(
        `• (<${issue.url}|${issue.identifier}>) ${issue.title} - _${assignee?.name}_`
      );
    } catch (error) {
      core.warning(
        `Failed to get assignee for issue ${issue.identifier}: ${error}`
      );
    }
  }

  return changelog.join("\n");
}

export async function sendToSlack(
  client: WebClient,
  channel: string,
  text: string
) {
  await client.chat.postMessage({
    channel,
    text,
    unfurl_links: false,
    unfurl_media: false,
    mrkdwn: true,
  });
}
