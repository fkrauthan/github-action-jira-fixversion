const core = require("@actions/core");
const JiraApi = require("jira-client")

let jira, domain, username, password, versionName, versionDescription, versionArchived, issueKeys, versionReleased;
(async () => {
    try {
        domain = core.getInput("domain");
        username = core.getInput("username");
        password = core.getInput("password");
        versionName = core.getInput("versionName");
        issueKeys = core.getInput("issueKeys");
        versionDescription = core.getInput("versionDescription") || "CD Version";
        versionArchived = core.getInput("versionArchived") === "true" || core.getInput("versionArchived") === true;
        versionReleased = core.getInput("versionReleased") === "true" || core.getInput("versionReleased") === true;

        // Initialize
        jira = new JiraApi({
            protocol: "https",
            host: domain,
            username: username,
            password: password,
        });
        //core.setFailed(`version is not correct: [${version}] must be "1.0.0"/"v1.0.0"/"test 1.0.0" pattern`);
        createAndSetVersion(issueKeys, versionName, versionDescription, versionArchived, versionReleased)

        // core.setOutput("new-version", nextVersion);
    } catch (error) {
        core.setFailed(error.message);
    }
})();

async function createAndSetVersion(issueKeys, versionName, versionDescription, versionArchived, versionReleased) {
    // from e.g. TEST-1 get the project key --> TEST
    const projectKey = getProjectKey(issueKeys);
    const versionId = await createOrRetrieveVersion(projectKey, versionName, versionDescription);

    const issueKeyArr = issueKeys.split(",");
    for (let i = 0; i < issueKeyArr.length; i++) {
        const issueKey = issueKeyArr[i];
        const issueId = await getIssueId(issueKey);
        await setVersion(issueId, versionId);
    }
    // archive version (passing it as argument while creating version doesn't work
    if (versionArchived) {
        await jira.updateVersion({
            id: versionId,
            archived: true,
        });
    }
    // publish version (passing it as argument while creating version doesn't work
    if (versionReleased) {
        const date = new Date().toISOString().substring(0,10);
        await jira.updateVersion({
            id: versionId,
            released: true,
            releaseDate: date
        });
    }
}

function getProjectKey(issueKey) {
    return issueKey.substring(0, issueKey.indexOf("-"));
}

async function getProjectId(projectKey) {
    const project = await jira.getProject(projectKey);
    return project.id
}

async function getIssueId(issueKey) {
    const issue = await jira.findIssue(issueKey);
    return issue.id;
}

async function createOrRetrieveVersion(projectKey, versionName, versionDescription) {
    const existingVersion = await getVersion(projectKey, versionName);
    if (existingVersion) {
        return existingVersion.id;
    }

    const date = new Date().toISOString().substring(0,10);
    const projectId = await getProjectId(projectKey);
    let version =  await jira.createVersion({
        description: versionDescription,
        name: versionName,
        released: false,
        startDate: date,
        projectId: projectId
    });
    return version.id;
}

async function getVersion(projectKey, versionName) {
    const versions = await jira.doRequest(jira.makeRequestHeader(jira.makeUri({
        pathname: `/project/${projectKey}/version`,
        query: {
            query: versionName,
        },
    })));
    for (let i = 0; i < versions.values.length; i++) {
        const version = versions.values[i];
        if (version.name === versionName) {
            return version;
        }
    }

    return undefined;
}

async function setVersion(issueId, versionId) {
    await jira.updateIssue(issueId, {
        update: {
            fixVersions: [{"add": {id: versionId}}]
        }
    });
}
