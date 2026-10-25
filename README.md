# DFM Editor

Eigenständiger browserbasierter Editor zum Eingeben und Visualisieren von Dimensionalen Faktenmodellen (DFM). Das Projekt ist unabhängig vom `task-administration-ui`.

## Architektur

- `frontend/`: Vue 3, TypeScript, CodeMirror 6 und D3. Der Browser stellt den DFM-Texteditor und die interaktive Graph-Visualisierung bereit.
- `backend/`: Spring Boot auf Java 21. Das Backend verwendet `task-app-dfm-core` zum Parsen und liefert ein neutrales Graph-Modell als JSON an das Frontend.
- `task-app-dfm-core`: Gemeinsame DFM-Fachlogik. Der Editor enthält keinen eigenen Parser.

Im Entwicklungsmodus läuft das Frontend mit Vite auf Port 5173 und leitet `/api` an das Backend auf Port 8082 weiter. Für den Produktions-Build werden die Frontend-Dateien in die Spring-Boot-Anwendung kopiert.

## Voraussetzungen

- Java 21
- Node.js 20.19+ oder 22.12+
- npm
- Maven (alternativ der Maven Wrapper im Backend)

## Lokal starten

Solange `task-app-dfm-core` noch nicht in GitHub Packages veröffentlicht ist, muss es zuerst lokal installiert werden. Im Core-Repository ausführen:

```powershell
.\mvnw.cmd clean install
```

Danach das Backend starten:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

In einem zweiten Terminal das Frontend starten:

```powershell
cd frontend
npm ci
npm run dev
```

Die Oberfläche ist unter <http://localhost:5173> verfügbar. Die Editor-API liegt unter <http://localhost:8082/api/dfm/parse>.

## Produktions-Build

```powershell
cd frontend
npm ci
npm run build
cd ..\backend
.\mvnw.cmd clean package
```

Das Spring-Boot-JAR enthält danach auch die gebaute Oberfläche. Starten lässt es sich mit:

```powershell
java -jar target\task-app-dfm-editor-0.1.0-SNAPSHOT.jar
```

Für den Bezug von `task-app-dfm-core` aus GitHub Packages ist ein Maven-Zugang mit Leserechten erforderlich. Das Repository ist im Backend-POM unter der Maven-Server-ID `github-core` eingetragen.

Falls das Core-Artefakt bereits veröffentlicht ist, muss `~/.m2/settings.xml` einen passenden Eintrag enthalten. Verwende dafür einen GitHub-Personal-Access-Token mit `read:packages`; lege den echten Token niemals im Repository ab.

```xml
<settings>
    <servers>
        <server>
            <id>github-core</id>
            <username>YOUR_GITHUB_USERNAME</username>
            <password>YOUR_READ_PACKAGES_TOKEN</password>
        </server>
    </servers>
</settings>
```
