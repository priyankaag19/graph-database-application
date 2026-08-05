// server/queries/cypher.js
// All Cypher lives here, in one place, so the "main queries" the README
// refers to are easy to find and review independently of route/HTTP code.
// Every query is parameterised ($paramName) - never string-concatenated.

module.exports = {
  // ---- constraints -------------------------------------------------------
  CONSTRAINTS: [
    'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT skill_id IF NOT EXISTS FOR (s:Skill) REQUIRE s.id IS UNIQUE',
    'CREATE CONSTRAINT job_id IF NOT EXISTS FOR (j:Job) REQUIRE j.id IS UNIQUE',
    'CREATE CONSTRAINT course_id IF NOT EXISTS FOR (c:Course) REQUIRE c.id IS UNIQUE',
    'CREATE CONSTRAINT company_id IF NOT EXISTS FOR (co:Company) REQUIRE co.id IS UNIQUE',
  ],

  // ---- simple lookups (single-hop, used to populate dropdowns) ----------
  LIST_PEOPLE: `
    MATCH (p:Person)
    OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
    RETURN p.id AS id, p.name AS name, p.currentTitle AS currentTitle, co.name AS company
    ORDER BY p.name`,

  LIST_JOBS: `
    MATCH (j:Job)
    RETURN j.id AS id, j.title AS title, j.level AS level
    ORDER BY j.title`,

  LIST_SKILLS: `
    MATCH (s:Skill)
    RETURN s.id AS id, s.name AS name, s.category AS category
    ORDER BY s.category, s.name`,

  // ---- person profile (1-hop skills + jobs held) -------------------------
  PERSON_PROFILE: `
    MATCH (p:Person {id: $personId})
    OPTIONAL MATCH (p)-[hs:HAS_SKILL]->(s:Skill)
    OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
    OPTIONAL MATCH (p)-[tt:TRANSITIONED_TO]->(j:Job)
    RETURN p.id AS id, p.name AS name, p.bio AS bio, p.currentTitle AS currentTitle,
           co.name AS company,
           collect(DISTINCT {id: s.id, name: s.name, category: s.category, level: hs.level, years: hs.yearsExperience}) AS skills,
           collect(DISTINCT {id: j.id, title: j.title, date: tt.date}) AS history`,

  /**
   * Skill-gap analysis for a person against a target job.
   * Multi-purpose single query: for every skill the job requires, it reports
   * whether the person already has it, and if not, which courses teach it.
   * This is a 2-hop pattern (Job->Skill<-Course) fanned out per-skill with an
   * aggregation that would need multiple JOINs + a LEFT JOIN + GROUP_CONCAT
   * in SQL, and still wouldn't generalise if REQUIRES_SKILL / HAS_SKILL
   * depth grew.
   */
  SKILL_GAP: `
    MATCH (j:Job {id: $jobId})-[r:REQUIRES_SKILL]->(s:Skill)
    OPTIONAL MATCH (p:Person {id: $personId})-[hp:HAS_SKILL]->(s)
    OPTIONAL MATCH (c:Course)-[t:TEACHES_SKILL]->(s)
    WITH s, r, hp, c, t
    ORDER BY t.depth
    WITH s, r, hp, collect(DISTINCT CASE WHEN c IS NULL THEN NULL ELSE {id: c.id, name: c.name, provider: c.provider, url: c.url, depth: t.depth} END) AS rawCourses
    RETURN s.id AS skillId, s.name AS skillName, r.importance AS importance,
           (hp IS NOT NULL) AS hasSkill,
           [x IN rawCourses WHERE x IS NOT NULL] AS courses
    ORDER BY hasSkill ASC, r.importance DESC`,

  /**
   * Shortest path between two skills through PREREQUISITE_OF / RELATED_TO
   * edges (2+ hops, variable length, undirected). This is the textbook
   * "awkward in SQL" query - a relational equivalent needs a recursive CTE
   * that self-joins the same edge table at unbounded depth and still can't
   * express "shortest" without extra bookkeeping.
   */
  SKILL_PATH: `
    MATCH path = shortestPath(
      (a:Skill {id: $fromSkillId})-[:RELATED_TO|PREREQUISITE_OF*1..6]-(b:Skill {id: $toSkillId})
    )
    RETURN [n IN nodes(path) | {id: n.id, name: n.name, category: n.category}] AS skillPath,
           [r IN relationships(path) | type(r)] AS relTypes,
           length(path) AS hops`,

  /**
   * Ranks every job by how much of its required skill set a person already
   * covers. Multi-hop (Person->Skill<-Job) with an aggregated ratio -
   * computing "% of requirements met" per job for every job in one pass is
   * a correlated-subquery mess in SQL; here it's a single pattern + fold.
   */
  JOB_MATCH_FOR_PERSON: `
    MATCH (p:Person {id: $personId})
    MATCH (j:Job)-[:REQUIRES_SKILL]->(allSkill:Skill)
    WITH p, j, count(DISTINCT allSkill) AS totalSkills
    OPTIONAL MATCH (p)-[:HAS_SKILL]->(matched:Skill)<-[:REQUIRES_SKILL]-(j)
    WITH j, totalSkills, count(DISTINCT matched) AS matchedSkills, collect(DISTINCT matched.name) AS matchedNames
    RETURN j.id AS jobId, j.title AS title, j.level AS level,
           matchedSkills, totalSkills,
           round(100.0 * matchedSkills / totalSkills) AS matchPercentage,
           matchedNames
    ORDER BY matchPercentage DESC, j.title ASC`,

  /**
   * For a target job, finds people who already transitioned into it, and
   * shows which of their skills actually bridged the gap (i.e. which
   * required skills they had going in). A 3-hop traversal
   * (Person->TRANSITIONED_TO->Job<-REQUIRES_SKILL-Skill<-HAS_SKILL-Person)
   * used to mine real precedent paths through the graph.
   */
  SIMILAR_TRANSITIONS: `
    MATCH (target:Job {id: $jobId})
    MATCH (p:Person)-[:TRANSITIONED_TO]->(target)
    MATCH (p)-[:HAS_SKILL]->(s:Skill)<-[:REQUIRES_SKILL]-(target)
    OPTIONAL MATCH (p)-[:WORKS_AT]->(co:Company)
    WITH p, co, collect(DISTINCT s.name) AS bridgingSkills
    RETURN p.id AS personId, p.name AS name, p.currentTitle AS currentTitle,
           co.name AS company, bridgingSkills, size(bridgingSkills) AS bridgeCount
    ORDER BY bridgeCount DESC`,

  /**
   * Skill neighborhood explorer: everything within 1-2 hops of a skill via
   * RELATED_TO, for "people who need X also tend to need..." suggestions.
   */
  SKILL_NEIGHBORHOOD: `
    MATCH (s:Skill {id: $skillId})-[:RELATED_TO*1..2]-(neighbor:Skill)
    WHERE neighbor.id <> $skillId
    RETURN DISTINCT neighbor.id AS id, neighbor.name AS name, neighbor.category AS category`,
};
