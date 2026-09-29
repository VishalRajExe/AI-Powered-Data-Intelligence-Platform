package ai.finalagent.workflow.execution;

import java.util.UUID;

import org.springframework.stereotype.Component;

/**
 * Which worker holds a lease. A name, not a number: when a job has been claimed by a process that
 * is now gone, the diagnosis starts with "which one was it", and the only useful answer is one that
 * survives looking at the process list.
 */
@Component
public class WorkerIdentity {

    private final String workerId;

    public WorkerIdentity() {
        String host = System.getenv().getOrDefault("HOSTNAME", "local");
        String runtime = System.getenv().getOrDefault("APP_ENV", "development");
        // VARCHAR(80) in workflow_jobs.worker_id, so the suffix is short and the prefix is stable.
        this.workerId = truncate(host + ":" + runtime + ":" + ProcessHandle.current().pid()
                + ":" + UUID.randomUUID().toString().substring(0, 8));
    }

    public String value() {
        return workerId;
    }

    private static String truncate(String value) {
        return value.length() <= 80 ? value : value.substring(0, 80);
    }
}
