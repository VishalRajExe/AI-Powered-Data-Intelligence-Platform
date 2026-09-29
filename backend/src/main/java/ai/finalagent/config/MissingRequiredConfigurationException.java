package ai.finalagent.config;

/**
 * Thrown when the environment cannot support a real run. The application refuses to start
 * rather than falling back to anything simulated — the inversion of the old project's central
 * defect, where a missing key silently swapped in a demo adapter.
 */
public class MissingRequiredConfigurationException extends RuntimeException {

    public MissingRequiredConfigurationException(String message) {
        super(message);
    }
}
