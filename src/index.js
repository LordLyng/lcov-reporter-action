import { promises as fs } from "fs"
import core from "@actions/core"
import { context, GitHub } from "@actions/github";

import { parse, percentage } from "./lcov"
import { diff } from "./comment"

async function main() {
	const name = core.getInput("name", { required: true })
	const minCoveragePercentage = core.getInput("minimum-coverage-percentage") || 0;
	const token = core.getInput("github-token")
	const lcovFile = core.getInput("lcov-file") || "./coverage/lcov.info"
	const baseFile = core.getInput("lcov-base")

	const raw = await fs.readFile(lcovFile, "utf-8").catch(err => null)
	if (!raw) {
		console.log(`No coverage report found at '${lcovFile}', exiting...`)
		return
	}

	const baseRaw = baseFile && await fs.readFile(baseFile, "utf-8").catch(err => null)
	if (baseFile && !baseRaw) {
		console.log(`No coverage report found at '${baseFile}', ignoring...`)
	}

	const options = {
		repository: context.payload.repository.full_name,
		prefix: `${process.env.GITHUB_WORKSPACE}/`,
	}

	if (context.eventName === "pull_request") {
		options.commit = context.payload.pull_request.head.sha
		options.head = context.payload.pull_request.head.ref
		options.base = context.payload.pull_request.base.ref
	} else if (context.eventName === "push") {
		options.commit = context.payload.after
		options.head = context.ref
	}

	const sha = getCheckRunContext().sha;

	const lcov = await parse(raw)
	const baselcov = baseRaw && await parse(baseRaw)
	const body = diff(lcov, baselcov, options)
	const isFailed = minCoveragePercentage != 0 && percentage(lcov) < minCoveragePercentage;
	const conclusion = isFailed ? 'failure' : 'success';
	const icon = isFailed ? '❌' : '✔️';

	await new GitHub(token).checks.create({
		head_sha: sha,
		name,
		conclusion,
		status: 'completed',
		output: {
			title: `${name} ${icon}`,
			summary: body,
		},
		...context.repo
	})
}

main().catch(function (err) {
	console.log(err)
	core.setFailed(err.message)
})

function getCheckRunContext() {
	if (context.eventName === 'workflow_run') {
		core.info('Action was triggered by workflow_run: using SHA and RUN_ID from triggering workflow')
		const event = context.payload
		if (!event.workflow_run) {
			throw new Error("Event of type 'workflow_run' is missing 'workflow_run' field")
		}
		if (event.workflow_run.conclusion === 'cancelled') {
			throw new Error(`Workflow run ${event.workflow_run.id} has been cancelled`)
		}
		return {
			sha: event.workflow_run.head_commit.id,
			runId: event.workflow_run.id
		}
	}

	const runId = context.runId
	if (context.payload.pull_request) {
		core.info(`Action was triggered by ${context.eventName}: using SHA from head of source branch`)
		const pr = context.payload.pull_request
		return { sha: pr.head.sha, runId }
	}

	return { sha: context.sha, runId }
}

