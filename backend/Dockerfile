# Build stage uses the JDK; runtime uses the JRE only.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies first, so source edits do not re-download the world on every build.
COPY pom.xml ./
RUN mvn -B -ntp dependency:go-offline

COPY src ./src
# Tests run in CI and via scripts/verify.sh; the image build skips them.
RUN mvn -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre-jammy

# curl is needed for the container healthcheck; adduser keeps the process off root.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 finalagent

WORKDIR /app
COPY --from=build /build/target/backend-0.1.0.jar app.jar
USER finalagent

EXPOSE 8080
ENV JAVA_OPTS=""

# Liveness, never readiness: a MySQL outage must not make the orchestrator restart
# a process that is otherwise healthy and would recover on its own.
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/actuator/health/liveness || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
