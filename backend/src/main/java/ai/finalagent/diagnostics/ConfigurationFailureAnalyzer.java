package ai.finalagent.diagnostics;

import ai.finalagent.config.MissingRequiredConfigurationException;
import org.springframework.boot.diagnostics.AbstractFailureAnalyzer;
import org.springframework.boot.diagnostics.FailureAnalysis;

/**
 * Turns a configuration failure into a short, actionable message instead of a stack trace.
 */
public class ConfigurationFailureAnalyzer extends AbstractFailureAnalyzer<MissingRequiredConfigurationException> {

    @Override
    protected FailureAnalysis analyze(Throwable rootFailure, MissingRequiredConfigurationException cause) {
        return new FailureAnalysis(
                cause.getMessage(),
                """
                Copy FINALAIAGENT/.env.example to FINALAIAGENT/.env and set every variable named above,
                then start the application again.

                There is no demo mode in this project and no fallback adapter. A missing credential is a
                configuration error, not a signal to substitute simulated data.""",
                cause);
    }
}
