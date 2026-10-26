# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /workspace

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci

COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

FROM maven:3.9-eclipse-temurin-21 AS backend-build
WORKDIR /workspace

COPY backend/pom.xml ./backend/pom.xml
COPY backend/src/ ./backend/src/
COPY --from=frontend-build /workspace/backend/src/main/resources/static/ ./backend/src/main/resources/static/

RUN --mount=type=cache,target=/root/.m2 \
    --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml,required=false \
    mvn -B -f backend/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=backend-build --chown=10001:10001 \
    /workspace/backend/target/task-app-dfm-editor-0.1.0-SNAPSHOT.jar ./app.jar

USER 10001:10001
EXPOSE 8082
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
