// scripts/seed.js
// Loads data/seed-data.json into CognoDB using parameterised, batched
// Cypher (UNWIND + MERGE), so re-running the script is safe/idempotent.
//
// Usage:
//   npm run seed

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { runWriteTransaction, closeDriver } = require('../server/db');
const Q = require('../server/queries/cypher');

const dataPath = path.join(__dirname, '..', 'data', 'seed-data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

async function ensureConstraints() {
  await runWriteTransaction(async (tx) => {
    for (const stmt of Q.CONSTRAINTS) {
      await tx.run(stmt);
    }
  });
  console.log('[seed] Constraints ensured.');
}

async function clearGraph() {
  await runWriteTransaction(async (tx) => {
    await tx.run('MATCH (n) DETACH DELETE n');
  });
  console.log('[seed] Cleared existing graph.');
}

async function loadCompanies() {
  await runWriteTransaction(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (c:Company {id: row.id})
       SET c.name = row.name, c.industry = row.industry`,
      { rows: data.companies }
    );
  });
  console.log(`[seed] Loaded ${data.companies.length} companies.`);
}

async function loadSkills() {
  await runWriteTransaction(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (s:Skill {id: row.id})
       SET s.name = row.name, s.category = row.category`,
      { rows: data.skills }
    );
  });
  console.log(`[seed] Loaded ${data.skills.length} skills.`);
}

async function loadSkillRelations() {
  const related = data.skillRelations.filter((r) => r.type === 'RELATED_TO');
  const prereq = data.skillRelations.filter((r) => r.type === 'PREREQUISITE_OF');

  await runWriteTransaction(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MATCH (a:Skill {id: row.from}), (b:Skill {id: row.to})
       MERGE (a)-[r:RELATED_TO]-(b)
       SET r.strength = row.strength`,
      { rows: related }
    );
    await tx.run(
      `UNWIND $rows AS row
       MATCH (a:Skill {id: row.from}), (b:Skill {id: row.to})
       MERGE (a)-[r:PREREQUISITE_OF]->(b)
       SET r.strength = row.strength`,
      { rows: prereq }
    );
  });
  console.log(`[seed] Loaded ${data.skillRelations.length} skill relationships.`);
}

async function loadCourses() {
  await runWriteTransaction(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (c:Course {id: row.id})
       SET c.name = row.name, c.provider = row.provider, c.url = row.url, c.durationHours = row.durationHours`,
      { rows: data.courses }
    );
    for (const course of data.courses) {
      await tx.run(
        `UNWIND $rows AS row
         MATCH (c:Course {id: $courseId}), (s:Skill {id: row.skillId})
         MERGE (c)-[t:TEACHES_SKILL]->(s)
         SET t.depth = row.depth`,
        { courseId: course.id, rows: course.teaches }
      );
    }
  });
  console.log(`[seed] Loaded ${data.courses.length} courses.`);
}

async function loadJobs() {
  await runWriteTransaction(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (j:Job {id: row.id})
       SET j.title = row.title, j.level = row.level`,
      { rows: data.jobs }
    );
    for (const job of data.jobs) {
      await tx.run(
        `UNWIND $rows AS row
         MATCH (j:Job {id: $jobId}), (s:Skill {id: row.skillId})
         MERGE (j)-[r:REQUIRES_SKILL]->(s)
         SET r.importance = row.importance`,
        { jobId: job.id, rows: job.requires }
      );
    }
  });
  console.log(`[seed] Loaded ${data.jobs.length} jobs.`);
}

async function loadPeople() {
  await runWriteTransaction(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (p:Person {id: row.id})
       SET p.name = row.name, p.bio = row.bio, p.currentTitle = row.currentTitle`,
      { rows: data.people }
    );
    for (const person of data.people) {
      await tx.run(
        `MATCH (p:Person {id: $personId}), (c:Company {id: $companyId})
         MERGE (p)-[:WORKS_AT]->(c)`,
        { personId: person.id, companyId: person.worksAt }
      );
      await tx.run(
        `UNWIND $rows AS row
         MATCH (p:Person {id: $personId}), (s:Skill {id: row.skillId})
         MERGE (p)-[hs:HAS_SKILL]->(s)
         SET hs.level = row.level, hs.yearsExperience = row.yearsExperience`,
        { personId: person.id, rows: person.skills }
      );
      if (person.transitions.length) {
        await tx.run(
          `UNWIND $rows AS row
           MATCH (p:Person {id: $personId}), (j:Job {id: row.jobId})
           MERGE (p)-[tt:TRANSITIONED_TO]->(j)
           SET tt.date = row.date`,
          { personId: person.id, rows: person.transitions }
        );
      }
    }
  });
  console.log(`[seed] Loaded ${data.people.length} people.`);
}

async function main() {
  console.log('[seed] Connecting to CognoDB...');
  try {
    await ensureConstraints();
    await clearGraph();
    await loadCompanies();
    await loadSkills();
    await loadSkillRelations();
    await loadCourses();
    await loadJobs();
    await loadPeople();
    console.log('[seed] Done. Graph is ready.');
  } catch (err) {
    console.error('[seed] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDriver();
  }
}

main();
