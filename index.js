/**
 * Gleiche Action, aber mit jira.js v6 (Stand 05.08.2026 erst 1 Tag alt).
 *
 * Unterschiede zu v5:
 *   - ESM-only, kein require() moeglich  -> action.yml: runs.using: node24
 *   - Node >= 22 vorausgesetzt
 *   - nur eine Transitive Dependency (zod), kein axios
 *   - createCloudClient() statt new Version2Client(); nur REST API v3 = Jira Cloud
 *   - updateVersion nimmt { id, body: {...} } statt flacher Felder
 *   - Fehlerklassen: ApiError/AuthError/NotFoundError mit .status
 *
 * package.json:
 *   "type": "module",
 *   "dependencies": { "jira.js": "^6.1.0", "@actions/core": "^3.0.1" }
 */
import * as core from "@actions/core";
import { createCloudClient, ApiError } from "jira.js";

const today = () => new Date().toISOString().slice(0, 10);

function getProjectKey(issueKey) {
    const projectKey = issueKey.split("-")[0];
    if (!projectKey) {
        throw new Error(`Project key nicht ermittelbar aus Issue key "${issueKey}"`);
    }
    return projectKey;
}

async function getProjectId(jira, projectKey) {
    const project = await jira.projects.getProject({ projectIdOrKey: projectKey });
    return Number(project.id);
}

async function findVersionByName(jira, projectId, versionName) {
    const versions = await jira.projectVersions.getProjectVersions({
        projectIdOrKey: String(projectId),
    });
    return versions.find(v => v.name === versionName);
}

async function createOrGetVersion(jira, projectId, versionName, versionDescription) {
    try {
        const version = await jira.projectVersions.createVersion({
            name: versionName,
            description: versionDescription,
            projectId,
            startDate: today(),
            released: false,
        });
        return version.id;
    } catch (error) {
        // 400 = Version mit diesem Namen existiert im Projekt bereits
        if (!(error instanceof ApiError) || error.status !== 400) throw error;

        const existing = await findVersionByName(jira, projectId, versionName);
        if (!existing) throw error;
        core.info(`Version "${versionName}" existiert bereits (id ${existing.id})`);
        return existing.id;
    }
}

async function setFixVersion(jira, issueKey, versionId) {
    await jira.issues.editIssue({
        issueIdOrKey: issueKey,
        update: { fixVersions: [{ add: { id: versionId } }] },
    });
}

async function createAndSetVersion(jira, opts) {
    let projectKey = (opts.projectKey || "").trim();

    const issueKeyArr = (opts.issueKeys ?? "").split(",").map(k => k.trim()).filter(Boolean);
    if (issueKeyArr.length === 0 && projectKey.length === 0) {
        throw new Error('input "issueKeys" and "projectKey" is empty');
    }
    if (projectKey.length === 0) {
        projectKey = getProjectKey(issueKeyArr[0]);
    }

    const projectId = await getProjectId(jira, projectKey);
    const versionId = await createOrGetVersion(
      jira, projectId, opts.versionName, opts.versionDescription,
    );

    for (const issueKey of issueKeyArr) {
        await setFixVersion(jira, issueKey, versionId);
        core.info(`fixVersion ${opts.versionName} set for ${issueKey}`);
    }

    // released/archived nicht beim Anlegen setzbar; erst freigeben, dann archivieren
    if (opts.versionReleased) {
        await jira.projectVersions.updateVersion({
            id: versionId,
            body: { projectId, released: true, releaseDate: today() },
        });
    }
    if (opts.versionArchived) {
        await jira.projectVersions.updateVersion({
            id: versionId,
            body: { projectId, archived: true },
        });
    }

    return versionId;
}

async function main() {
    const domain = core.getInput("domain", { required: true });
    const jira = createCloudClient({
        host: domain.startsWith("http") ? domain : `https://${domain}`,
        auth: {
            type: "basic",
            email: core.getInput("username", { required: true }),
            apiToken: core.getInput("password", { required: true }),
        },
    });

    const versionId = await createAndSetVersion(jira, {
        projectKey: core.getInput("projectKey"),
        issueKeys: core.getInput("issueKeys"),
        versionName: core.getInput("versionName", { required: true }),
        versionDescription: core.getInput("versionDescription") || "CD Version",
        versionArchived: core.getInput("versionArchived").toLowerCase() === "true",
        versionReleased: core.getInput("versionReleased").toLowerCase() === "true",
    });

    core.setOutput("version-id", versionId);
}

main().catch(error => {
    core.setFailed(error instanceof Error ? error.message : String(error));
});
