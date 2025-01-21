"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendToSlack = exports.compileChangelog = exports.updateIssues = exports.getDoneStatus = exports.createVersionLabel = exports.getInput = exports.getVersion = void 0;
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: ".env.local" });
function getVersion(appName) {
    const prefix = `apps/${appName}/`;
    try {
        const appJson = JSON.parse(fs.readFileSync(`${prefix}app.json`, "utf8"));
        if (appJson) {
            return `${appJson.expo.version}-${appJson.expo.extra.ota.version}`;
        }
    }
    catch {
        // no-op
    }
    const packageJson = JSON.parse(fs.readFileSync(`${prefix}package.json`, "utf8"));
    return packageJson.version;
}
exports.getVersion = getVersion;
function getInput(name) {
    return process.env[name] ?? core.getInput(name);
}
exports.getInput = getInput;
async function createVersionLabel({ client, version, labelName, }) {
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
        core.setFailed(`Parent label "Versions - ${labelName}" not found in Linear.`);
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
    }
    catch (error) {
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
exports.createVersionLabel = createVersionLabel;
async function getDoneStatus(client) {
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
exports.getDoneStatus = getDoneStatus;
async function updateIssues(client, { versionLabel, labelName, stateId, }) {
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
            core.info(`Updated issue ${issue.identifier} with label ${versionLabel.name} and marked as Done.`);
        }
        catch (error) {
            core.warning(`Failed to update issue ${issue.identifier}: ${error}`);
        }
    }
    return issuesToUpdate.nodes;
}
exports.updateIssues = updateIssues;
async function compileChangelog({ appName, issues, labelName, version, }) {
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
            const githubLinks = attachments.nodes.reduce((acc, attachment) => {
                if (attachment.sourceType === "github") {
                    const prId = attachment.url.split("/").pop();
                    acc.push(`<${attachment.url}|#${prId}>`);
                }
                return acc;
            }, []);
            changelog.push(`• (<${issue.url}|${issue.identifier}>) ${issue.title} - _${assignee?.name}_`, `    PRs: ${githubLinks.join(", ")}\n`);
        }
        catch (error) {
            core.warning(`Failed to get assignee for issue ${issue.identifier}: ${error}`);
        }
    }
    return changelog.join("\n");
}
exports.compileChangelog = compileChangelog;
async function sendToSlack(client, channel, text) {
    await client.chat.postMessage({
        channel,
        text,
        unfurl_links: false,
        unfurl_media: false,
        mrkdwn: true,
    });
}
exports.sendToSlack = sendToSlack;
