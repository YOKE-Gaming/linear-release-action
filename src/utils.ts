import * as core from "@actions/core";
import { Issue, IssueLabel, LinearClient, WorkflowState } from "@linear/sdk";
import * as fs from "fs";
import { WebClient } from "@slack/web-api";

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

export function getVersion(appName: string): string {
  const prefix = `apps/${appName}/`;
  try {
    const appJson = JSON.parse(fs.readFileSync(`${prefix}app.json`, "utf8"));
    if (appJson) {
      return `${appJson.expo.version}-${appJson.expo.extra.ota.version}`;
    }
  } catch {
    // no-op
  }

  const packageJson = JSON.parse(fs.readFileSync(`${prefix}package.json`, "utf8"));
  return packageJson.version;
}

export function getInput(name: string): string {
  return process.env[name] ?? core.getInput(name);
}

export async function createVersionLabel({
  client,
  version,
  labelName,
}: {
  client: LinearClient;
  version: string;
  labelName: string;
}): Promise<IssueLabel> {
  core.info(`Creating a new label for version: ${version}...`);
  const parentLabelNodes = await client.issueLabels({
    filter: {
      name: {
        in: [`Versions - ${labelName}`],
      },
    },
  });
  const parentLabel = parentLabelNodes.nodes[0];
  if (!parentLabel) {
    core.setFailed(
      `Parent label "Versions - ${labelName}" not found in Linear.`
    );
  }
  const parentId = parentLabel.id;
  const teamId = (await parentLabel.team)?.id;
  if (!teamId) {
    core.setFailed(`Team not found for label "Versions - ${labelName}"`);
  }

  const versionLabelName = `${labelName} - ${version}`;

  // this will throw an error if the label already exists
  let versionLabel;
  try {
    const createdLabel = await client.createIssueLabel({
      name: versionLabelName,
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
          eq: versionLabelName,
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
    labelName,
    stateId,
  }: { versionLabel: IssueLabel; labelName: string; stateId: string }
) {
  core.info(`Finding "Ready For Release" issues in ${labelName}...`);
  const issuesToUpdate = await client.issues({
    filter: {
      labels: {
        name: {
          eq: labelName,
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
  appName,
  issues,
  labelName,
  version,
}: {
  appName: string;
  issues: Issue[];
  labelName: string;
  version: string;
}): Promise<string> {
  const changelog = [
    `*Release Notes: \`${labelName}-${version}\`* has been successfully released! :rocket:`,
    `*Release Date:* ${new Date().toLocaleDateString()}`,
    `*Total Issues:* ${issues.length}\n`,
    "Here's a summary of the completed issues:",
  ];

  for (const issue of issues) {
    try {
      const assignee = await issue.assignee;
      const attachments = await issue.attachments();
      const githubLinks = attachments.nodes.reduce<string[]>(
        (acc, attachment) => {
          if (attachment.sourceType === "github") {
            const prId = attachment.url.split("/").pop();
            acc.push(`<${attachment.url}|#${prId}>`);
          }
          return acc;
        },
        []
      );
      changelog.push(
        `• (<${issue.url}|${issue.identifier}>) ${issue.title} - _${assignee?.name}_`,
        `    PRs: ${githubLinks.join(", ")}\n`
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
