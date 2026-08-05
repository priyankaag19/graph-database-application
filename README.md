# SkillPath

A route planner for careers. Pick where someone stands today and the role
they want next, and SkillPath traces the skill gap, recommends courses for
what's missing, finds the shortest path between any two skills in the graph,
and surfaces real people who've already made that jump.

Built on **CognoDB** (openCypher over Bolt) via the official `neo4j-driver`.

---

## Why a graph database?

Career growth *is* a graph, not a table. The interesting questions are all
about connections:

- "What's the shortest way from skill A to skill B?" — a variable-length,
  shortest-path traversal. In SQL this is a recursive CTE self-joining an
  edges table at unbounded depth, and it still can't express "shortest"
  without extra bookkeeping (visited sets, depth counters). In Cypher it's
  `shortestPath((a)-[:RELATED_TO|PREREQUISITE_OF*1..6]-(b))` — one line.
- "Which people already made the move I'm considering, and which of *their*
  skills actually mattered?" — a 3-hop pattern
  (`Person → TRANSITIONED_TO → Job ← REQUIRES_SKILL ← Skill ← HAS_SKILL ← Person`)
  that reads like the question itself.
- "Rank every job by how much of it I already cover" — a correlated,
  per-row aggregation across a variable number of skills per job. In SQL
  that's a subquery-per-job or a window-function gymnastics session; in
  Cypher it's a single `MATCH` + `WITH` + `count()`.
- The schema itself keeps changing shape as skills gain new prerequisite
  chains, jobs add new requirements, or courses start covering multiple
  skills. A graph absorbs new relationship types without a migration; a
  relational schema would need new junction tables or, worse, a widening
  "skills_required" join table with awkward self-referential FKs for the
  prerequisite chain.

None of this is impossible in a relational database — it's just fighting the
tool. A graph database makes the traversal the *primitive*, not an
afterthought bolted on with recursive SQL.

---

## Data model

```
 (Company) <--WORKS_AT-- (Person) --HAS_SKILL {level, yearsExperience}--> (Skill)
                             |                                               ^  ^
                             |                                               |  |
                    TRANSITIONED_TO {date}                        PREREQUISITE_OF |
                             |                                               |  |
                             v                                               |  RELATED_TO {strength}
                           (Job) --REQUIRES_SKILL {importance}--------------->  (self-referential
                             ^                                                   among Skills)
                             |
                    TEACHES_SKILL {depth}
                             |
                          (Course)
```

**Nodes**
| Label | Key properties |
|---|---|
| `Person` | `id`, `name`, `bio`, `currentTitle` |
| `Skill` | `id`, `name`, `category` |
| `Job` | `id`, `title`, `level` |
| `Course` | `id`, `name`, `provider`, `url`, `durationHours` |
| `Company` | `id`, `name`, `industry` |

**Relationships**
| Type | Direction | Properties | Meaning |
|---|---|---|---|
| `HAS_SKILL` | Person → Skill | `level`, `yearsExperience` | what someone knows today |
| `WORKS_AT` | Person → Company | — | current employer |
| `TRANSITIONED_TO` | Person → Job | `date` | a career move someone actually made |
| `REQUIRES_SKILL` | Job → Skill | `importance` (1–5) | what a role needs |
| `TEACHES_SKILL` | Course → Skill | `depth` (foundational/intermediate) | what closes a gap |
| `PREREQUISITE_OF` | Skill → Skill | `strength` | directed learning order |
| `RELATED_TO` | Skill — Skill (undirected) | `strength` | lateral skill adjacency |

Full model + seed values live in [`data/seed-data.json`](data/seed-data.json).

---

## Project structure

```
skillpath/
├── README.md
├── package.json
├── .env              # copy to .env, never commit the real one
├── .gitignore
├── data/
│   └── seed-data.json        # companies, skills, courses, jobs, people
├── scripts/
│   └── seed.js                # loads seed-data.json into CognoDB (idempotent)
├── server/
│   ├── index.js               # Express app entry point, health check
│   ├── db.js                  # neo4j-driver connection + session helpers
│   ├── queries/
│   │   └── cypher.js          # every Cypher statement, documented, parameterised
│   └── routes/
│       └── api.js             # REST endpoints wired to the Cypher queries
└── public/                    # static frontend, no build step
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

---

## Setup

### 1. Create a CognoDB instance

1. Go to [console.cognodb.com/signup](https://console.cognodb.com/signup) and
   create a free account (no credit card required).
2. From the console, create a **free (c0)** instance and pick a region. It
   provisions in under a minute — each workspace gets one free instance.
3. Copy the connection URI (`bolt+s://<instance-id>.databases.cognodb.cloud`)
   and the generated password for user `cognodb`. **The password is shown
   once** — save it now.

### 2. Configure the app

```bash
git clone <this-repo-url>
cd skillpath
cp .env
```

Edit `.env`:

```
COGNODB_URI=bolt+s://<instance-id>.databases.cognodb.cloud
COGNODB_USER=cognodb
COGNODB_PASSWORD=<your-generated-password>
PORT=3000
```

`.env` is git-ignored — connection details never get committed.

### 3. Install, seed, run

```bash
npm install
npm run seed     # creates constraints + loads companies/skills/courses/jobs/people
npm start        # http://localhost:3000
```

`npm run seed` is idempotent — it clears the graph and reloads it, so it's
safe to re-run any time the seed data changes. Every write is a batched,
parameterised `UNWIND ... MERGE`, not string-concatenated Cypher.

### 4. Develop

```bash
npm run dev       # restarts on file change (node --watch)
```

---

## The main queries, explained

All queries live in [`server/queries/cypher.js`](server/queries/cypher.js).

**`SKILL_GAP`** — given a person and a target job, returns every required
skill, whether the person already has it, and (for the ones they don't)
which courses teach it. Powers the "route track" on the results screen.

**`SKILL_PATH`** — `shortestPath()` across `RELATED_TO` / `PREREQUISITE_OF`
edges between any two skills, 1–6 hops, undirected. This is the query a
relational schema handles worst: unbounded recursive traversal with a
shortest-path guarantee.

**`JOB_MATCH_FOR_PERSON`** — ranks every job by the percentage of its
required skills a person already has, computed in one pass over the graph.

**`SIMILAR_TRANSITIONS`** — a 3-hop query: for a target job, find people who
already transitioned into it, and which of their pre-existing skills
actually matched the job's requirements. This mines real precedent out of
the graph instead of asking someone to guess.

**`SKILL_NEIGHBORHOOD`** — 1–2 hop `RELATED_TO` walk from a skill, used for
lateral "people who need X also tend to need…" suggestions.

Every query above is parameterised (`$personId`, `$jobId`, etc.) and run
through the official `neo4j-driver`, never through string interpolation.

---

## API

| Method & path | Purpose |
|---|---|
| `GET /health` | Verifies CognoDB connectivity |
| `GET /api/people` | List people (for the dropdown) |
| `GET /api/jobs` | List jobs |
| `GET /api/skills` | List skills |
| `GET /api/people/:id` | Full profile: skills, employer, history |
| `GET /api/gap-analysis?personId=&jobId=` | Skill gap + course recommendations |
| `GET /api/skill-path?fromSkillId=&toSkillId=` | Shortest path between two skills |
| `GET /api/job-match/:personId` | Every job ranked by skill-overlap % |
| `GET /api/similar-transitions?jobId=` | People who've made this move already |
| `GET /api/skill-neighborhood/:skillId` | Related skills, 1–2 hops out |

If CognoDB is unreachable, every data endpoint returns `503` with a plain
explanation instead of a raw stack trace, and the UI surfaces that in the
status pill and an error panel rather than hanging on a blank screen.

---

## UI/UX notes

The interface is framed as a route planner — "departing from" a person,
"arriving at" a role — because that's literally what a skill-gap traversal
is: a route across a graph. Required skills render as stations along a
transit line; teal means "already have it," amber means "gap to close,"
with the top 2 recommended courses attached directly to each gap station.
Loading, empty, and error states are all designed, not left as blank divs.


---

## Notes on scale

The free (c0) CognoDB tier is 0.5 vCPU / 256 MB RAM / 1 GB disk. The seed
data (5 companies, 25 skills, 12 courses, 8 jobs, 12 people, ~120
relationships) is intentionally small — enough to make every traversal
meaningful without stressing a burstable free instance. The data model
generalizes to a few hundred thousand nodes without any query changes.
