// server/routes/api.js
const express = require('express');
const { runQuery } = require('../db');
const Q = require('../queries/cypher');

const router = express.Router();

// Small helper so every route gets the same try/catch + "DB unreachable"
// handling without repeating it in every handler.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err.message);
      const dbUnreachable =
        err.code === 'ServiceUnavailable' ||
        /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connect/i.test(err.message || '');
      res.status(dbUnreachable ? 503 : 500).json({
        error: dbUnreachable
          ? 'Could not reach the CognoDB instance. Check that it is running and that COGNODB_URI / credentials in .env are correct.'
          : 'Something went wrong processing that request.',
      });
    }
  };
}

router.get('/people', handle(async (req, res) => {
  const rows = await runQuery(Q.LIST_PEOPLE);
  res.json(rows);
}));

router.get('/jobs', handle(async (req, res) => {
  const rows = await runQuery(Q.LIST_JOBS);
  res.json(rows);
}));

router.get('/skills', handle(async (req, res) => {
  const rows = await runQuery(Q.LIST_SKILLS);
  res.json(rows);
}));

router.get('/people/:id', handle(async (req, res) => {
  const rows = await runQuery(Q.PERSON_PROFILE, { personId: req.params.id });
  if (!rows.length || !rows[0].id) {
    return res.status(404).json({ error: 'Person not found.' });
  }
  res.json(rows[0]);
}));

router.get('/gap-analysis', handle(async (req, res) => {
  const { personId, jobId } = req.query;
  if (!personId || !jobId) {
    return res.status(400).json({ error: 'personId and jobId query params are required.' });
  }
  const rows = await runQuery(Q.SKILL_GAP, { personId, jobId });
  res.json(rows);
}));

router.get('/skill-path', handle(async (req, res) => {
  const { fromSkillId, toSkillId } = req.query;
  if (!fromSkillId || !toSkillId) {
    return res.status(400).json({ error: 'fromSkillId and toSkillId query params are required.' });
  }
  const rows = await runQuery(Q.SKILL_PATH, { fromSkillId, toSkillId });
  res.json(rows[0] || { skillPath: [], relTypes: [], hops: null });
}));

router.get('/job-match/:personId', handle(async (req, res) => {
  const rows = await runQuery(Q.JOB_MATCH_FOR_PERSON, { personId: req.params.personId });
  res.json(rows);
}));

router.get('/similar-transitions', handle(async (req, res) => {
  const { jobId } = req.query;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId query param is required.' });
  }
  const rows = await runQuery(Q.SIMILAR_TRANSITIONS, { jobId });
  res.json(rows);
}));

router.get('/skill-neighborhood/:skillId', handle(async (req, res) => {
  const rows = await runQuery(Q.SKILL_NEIGHBORHOOD, { skillId: req.params.skillId });
  res.json(rows);
}));

module.exports = router;
