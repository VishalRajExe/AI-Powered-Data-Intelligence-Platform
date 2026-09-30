package ai.finalagent.workflow.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import javax.sql.DataSource;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import ai.finalagent.workflow.domain.Records.Plan;
import ai.finalagent.workflow.domain.Records.Workflow;

/**
 * The two definition tables. Plans are written once and never updated: {@code version} is the
 * only way a plan changes, and a run keeps pointing at the version it executed.
 */
@Repository
public class WorkflowRepository {

    private final JdbcTemplate jdbc;

    public WorkflowRepository(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    private static final RowMapper<Workflow> WORKFLOW_ROW = (rs, n) -> new Workflow(
            rs.getString("id"), rs.getString("workspace_id"), rs.getString("created_by_id"),
            rs.getString("name"), rs.getString("requirement_text"), rs.getString("status"),
            rs.getString("planning_status"), rs.getString("planning_error_code"),
            rs.getString("planning_error_message"), ts(rs.getTimestamp("created_at")),
            ts(rs.getTimestamp("updated_at")));

    private static final RowMapper<Plan> PLAN_ROW = (rs, n) -> new Plan(
            rs.getString("id"), rs.getString("workspace_id"), rs.getString("workflow_id"),
            rs.getInt("version"), rs.getString("objective"), rs.getString("requirement"),
            rs.getString("extraction_schema"), rs.getString("steps"), rs.getString("search_strategy"),
            rs.getString("source_policy"), rs.getString("completion_criteria"),
            rs.getString("plan_hash"), rs.getString("created_by_id"), ts(rs.getTimestamp("created_at")));

    private static Instant ts(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public void insert(String id, String workspaceId, String createdById, String name,
                       String requirementText) {
        jdbc.update("INSERT INTO workflows (id, workspace_id, created_by_id, name, requirement_text, "
                + "status, planning_status) VALUES (?, ?, ?, ?, ?, 'DRAFT', 'NOT_STARTED')",
                id, workspaceId, createdById, name, requirementText);
    }

    public Optional<Workflow> findById(String id) {
        return jdbc.query("SELECT * FROM workflows WHERE id = ?", WORKFLOW_ROW, id).stream().findFirst();
    }

    public void markPlanning(String id) {
        jdbc.update("UPDATE workflows SET planning_status = 'PLANNING' WHERE id = ? "
                + "AND planning_status IN ('NOT_STARTED','FAILED')", id);
    }

    public void markPlanned(String id) {
        jdbc.update("UPDATE workflows SET planning_status = 'PLANNED', status = 'ACTIVE', "
                + "planning_error_code = NULL, planning_error_message = NULL WHERE id = ?", id);
    }

    /**
     * A planning failure is durable and readable. The old project recorded planning errors only in
     * the HTTP response, so a workflow stuck in a failed plan looked identical to one that had
     * never been planned.
     */
    public void markPlanningFailed(String id, String errorCode, String errorMessage) {
        jdbc.update("UPDATE workflows SET planning_status = 'FAILED', planning_error_code = ?, "
                + "planning_error_message = ? WHERE id = ?", errorCode,
                errorMessage == null ? null : truncate(errorMessage, 1000), id);
    }

    public void insertPlan(Plan plan) {
        jdbc.update("""
                INSERT INTO workflow_plans
                  (id, workspace_id, workflow_id, version, objective, requirement, extraction_schema,
                   steps, search_strategy, source_policy, completion_criteria, plan_hash, created_by_id)
                VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON),
                        CAST(? AS JSON), CAST(? AS JSON), ?, ?)
                """, plan.id(), plan.workspaceId(), plan.workflowId(), plan.version(),
                plan.objective(), plan.requirementJson(), plan.extractionSchemaJson(), plan.stepsJson(),
                plan.searchStrategyJson(), plan.sourcePolicyJson(), plan.completionCriteriaJson(),
                plan.planHash(), plan.createdById());
    }

    public Optional<Plan> findLatestPlan(String workflowId) {
        return jdbc.query("SELECT * FROM workflow_plans WHERE workflow_id = ? "
                + "ORDER BY version DESC LIMIT 1", PLAN_ROW, workflowId).stream().findFirst();
    }

    public Optional<Plan> findPlan(String id) {
        return jdbc.query("SELECT * FROM workflow_plans WHERE id = ?", PLAN_ROW, id).stream().findFirst();
    }

    public int nextPlanVersion(String workflowId) {
        Integer version = jdbc.queryForObject(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM workflow_plans WHERE workflow_id = ?",
                Integer.class, workflowId);
        return version == null ? 1 : version;
    }

    /**
     * Workflow history, newest first.
     *
     * <p>{@code runCounts} is filled per row rather than joined: a history page is twenty workflows,
     * and a join that picks the latest plan per workflow would have to aggregate the whole plan table.
     * Twenty lookups on its unique key is the cheaper and more obviously correct shape.
     */
    public List<Workflow> list(String workspaceId, String status, int limit, int offset) {
        StringBuilder sql = new StringBuilder("SELECT * FROM workflows WHERE workspace_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(workspaceId);
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        sql.append(" ORDER BY created_at DESC, id LIMIT ? OFFSET ?");
        args.add(limit);
        args.add(offset);
        return jdbc.query(sql.toString(), WORKFLOW_ROW, args.toArray());
    }

    public int countAll(String workspaceId, String status) {
        Integer total = status == null || status.isBlank()
                ? jdbc.queryForObject("SELECT COUNT(*) FROM workflows WHERE workspace_id = ?",
                        Integer.class, workspaceId)
                : jdbc.queryForObject("SELECT COUNT(*) FROM workflows WHERE workspace_id = ?"
                        + " AND status = ?", Integer.class, workspaceId, status);
        return total == null ? 0 : total;
    }

    /**
     * How many runs each of these workflows has, so a history list can state an attempt count without
     * a query per row. Workflows with no runs are present with zero: a listing that omits them would
     * make "never run" and "not in this workspace" read the same.
     */
    public Map<String, Integer> runCounts(String workspaceId, List<String> workflowIds) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        if (workflowIds.isEmpty()) {
            return counts;
        }
        workflowIds.forEach(id -> counts.put(id, 0));
        String placeholders = String.join(",", Collections.nCopies(workflowIds.size(), "?"));
        jdbc.query("SELECT workflow_id, COUNT(*) AS run_count FROM workflow_runs"
                        + " WHERE workspace_id = ? AND workflow_id IN (" + placeholders + ")"
                        + " GROUP BY workflow_id",
                (RowCallbackHandler) rs -> counts.put(rs.getString("workflow_id"),
                        rs.getInt("run_count")),
                concat(workspaceId, workflowIds));
        return counts;
    }

    private static Object[] concat(String workspaceId, List<String> ids) {
        Object[] args = new Object[ids.size() + 1];
        args[0] = workspaceId;
        for (int i = 0; i < ids.size(); i++) {
            args[i + 1] = ids.get(i);
        }
        return args;
    }

    /**
     * The newest plan version each of these workflows has, as {@code workflowId → "version N"}.
     *
     * <p>Worth a query of its own because a history list that says "planned" without a version is
     * quoting the workflow row's {@code planning_status}, which is written by the planning call and
     * goes stale if a later re-plan failed: the plan table is what actually holds the versions.
     */
    public Map<String, Integer> latestPlanVersions(List<String> workflowIds) {
        Map<String, Integer> versions = new LinkedHashMap<>();
        if (workflowIds.isEmpty()) {
            return versions;
        }
        String placeholders = String.join(",", Collections.nCopies(workflowIds.size(), "?"));
        jdbc.query("SELECT workflow_id, MAX(version) AS version FROM workflow_plans"
                        + " WHERE workflow_id IN (" + placeholders + ") GROUP BY workflow_id",
                (RowCallbackHandler) rs -> versions.put(rs.getString("workflow_id"),
                        rs.getInt("version")),
                workflowIds.toArray());
        return versions;
    }

    private static String truncate(String value, int max) {
        return value != null && value.length() > max ? value.substring(0, max - 3) + "..." : value;
    }
}
