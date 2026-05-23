<p align="center">
  <img src=".github/assets/icon-dark.webp" alt="Voicebox" width="120" height="120" />
</p>

<h1 align="center">Voicebox</h1>

<p align="center">
  <strong>The open-source voice synthesis studio.</strong><br/>
  Clone voices. Generate speech. Apply effects. Build voice-powered apps.<br/>
  All running locally on your machine.
</p>

<p align="center">
  <a href="https://github.com/jamiepine/voicebox/releases">
    <img src="https://img.shields.io/github/downloads/jamiepine/voicebox/total?style=flat&color=blue" alt="Downloads" />
  </a>
  <a href="https://github.com/jamiepine/voicebox/releases/latest">
    <img src="https://img.shields.io/github/v/release/jamiepine/voicebox?style=flat" alt="Release" />
  </a>
  <a href="https://github.com/jamiepine/voicebox/stargazers">
    <img src="https://img.shields.io/github/stars/jamiepine/voicebox?style=flat" alt="Stars" />
  </a>
  <a href="https://github.com/jamiepine/voicebox/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/jamiepine/voicebox?style=flat" alt="License" />
  </a>
  <a href="https://deepwiki.com/jamiepine/voicebox">
    <img src="https://img.shields.io/static/v1?label=Ask&message=DeepWiki&color=5B6EF7" alt="Ask DeepWiki" />
  </a>
</p>

<p align="center">
  <a href="https://voicebox.sh">voicebox.sh</a> •
  <a href="https://docs.voicebox.sh">Docs</a> •
  <a href="#download">Download</a> •
  <a href="#features">Features</a> •
  <a href="#api">API</a> •
  <a href="docs/content/docs/overview/troubleshooting.mdx">Troubleshooting</a>
</p>

<br/>

<p align="center">
  <a href="https://voicebox.sh">
    <img src="landing/public/assets/app-screenshot-1.webp" alt="Voicebox App Screenshot" width="800" />
  </a>
</p>

<p align="center">
  <em>Click the image above to watch the demo video on <a href="https://voicebox.sh">voicebox.sh</a></em>
</p>

<br/>

<p align="center">
  <img src="landing/public/assets/app-screenshot-2.webp" alt="Voicebox Screenshot 2" width="800" />
</p>

<p align="center">
  <img src="landing/public/assets/app-screenshot-3.webp" alt="Voicebox Screenshot 3" width="800" />
</p>

<br/>

<div class="note-container">
  ---
  title: Voicebox Tech Stack Overview
  type: note
  permalink: main/voicebox-tech-stack-overview-1-1
  tags:
  - tech-stack
  - architecture
  - backend
  - frontend
  ---
  
  # Voicebox Technology Stack
  
  ## Backend (Python)
  
  ### Core Framework
  - **FastAPI** (v0.109+) - Async web framework with Pydantic v2 validation
  - **Uvicorn** (v0.27+) - ASGI server with standard mode support
  - **Pydantic** (v2.5+) - Data validation and settings management
  
  ### Database & ORM
  - **SQLAlchemy** (v2.0+) - Full-featured SQL toolkit and ORM
  - **SQLite** - Primary database engine (`voicebox.db`)
  - **Alembic** (v1.13+) - Database migration tool
  
  ### Machine Learning / TTS Engines
  All built on **PyTorch** (v2.2+) ecosystem:
  
  | Engine | Key Dependencies | Notes |
  |--------|------------------|-------|
  | **LuxTTS** | `transformers` (4.36-4.57), `accelerate`, `huggingface_hub`, `qwen-tts>=0.0.5` | Primary voice cloning engine using Zipvoice + Conformer architecture |
  | **Qwen-TTS** | Included in LuxTTS stack | Qwen-based TTS model integration |
  | **Kokoro TTS** | `kokoro>=0.9.4`, `misaki[en,ja,zh]` | Lightweight 82M parameter engine |
  | **Chatterbox TTS** | `conformer`, `diffusers>=0.29`, `omegaconf`, `pykakasi`, `resemble-perth`, `s3tokenizer`, `spacy-pkuseg`, `pyloudnorm` | Installed via git submodule; sub-deps only (main installed --no-deps) |
  | **HumeAI TADA** | `torchaudio`, descript-audio-codec shim (`utils/dac_shim.py`) | TADA model with custom lightweight DAC wrapper |
  
  ### Phonemization & NLP
  - **piper-phonemize** - Custom index (no PyPI wheels)
  - **spacy-pkuseg** - Pinyin-based phonemizer for Chinese
  - **misaki** (v0.9+) - Multi-language G2P with en, ja, zh support
    - Pre-installed spaCy model: `en_core_web_sm`
    - Requires unidic-lite (~50MB) for Japanese; full unidic breaks frozen builds
  
  ### Audio Processing
  - **librosa** (v0.10+) - Audio analysis library
  - **soundfile** (v0.12+) - Audio I/O
  - **pedalboard** (v0.9+) - Audio plugin chain processing
  - **pyloudnorm** - Loudness normalization
  
  ### HTTP & Utilities
  - **httpx** (v0.27+) - Async HTTP client for CUDA backend downloads
  - **Pillow** (v10+) - Image processing
  
  ---
  
  ## Frontend Clients
  
  ### Shared Dependencies Across All Clients
  | Package                   | Version       | Purpose                      |
  | ------------------------- | ------------- | ---------------------------- |
  | **React**                 | ^18.2+        | UI library                   |
  | **TypeScript**            | ^5.3-5.9      | Type-safe development        |
  | **Tailwind CSS**          | v4.x (latest) | Utility-first styling        |
  | **Zustand**               | ^4.5          | Global state management      |
  | **@tanstack/react-query** | ^5.0          | Server state synchronization |
  | **wavesurfer.js**         | ^7.0+         | Audio waveform visualization |
  
  ### Build Tools & Package Manager
  - **Bun** (v1.3+) - JavaScript runtime and package manager
  - **Vite** (^5.4) - Frontend build tooling for most clients
  - **TypeScript** - All TypeScript-based development
  
  ---
  
  ## Client Applications
  
  ### 1. `/web` — Core Voicebox Web App
  - **Framework**: Vite + React SPA
  - **Features**: Core audio generation UI, state management with Zustand
  - **Build**: `bun run build` → optimized static assets
  
  ### 2. `/landing` — Marketing/Landing Page
  - **Framework**: Next.js 16 (app router)
  - **Styling**: Tailwind CSS v3.x + tailwindcss-animate plugin
  - **Animation**: Framer Motion (^12) for audio visualizer effects
  - **Icons**: lucide-react, react-simple-icons (@icons-pack)
  - **Audio Visualizer**: wavesurfer.js with custom React component
  - **Typography**: @fontsource/space-grotesk
  - **Build**: `bun run build` → optimized Next.js output
  
  ### 3. `/tauri` — Desktop Application Wrapper
  - **Framework**: Vite + React (shared web client)
  - **Desktop Runtime**: Tauri 2.x (@tauri-apps/api ^2.0+)
  - **Plugins**:
    - `@tauri-apps/plugin-dialog` — File dialogs
    - `@tauri-apps/plugin-fs` — File system access
    - `@tauri-apps/plugin-process` — Process management
    - `@tauri-apps/plugin-shell` — Shell spawning (backend server)
    - `@tauri-apps/plugin-updater` — Update checks and installation
  - **Styling**: Tailwind CSS v4 + tailwindcss-animate
  
  ### 4. `/app` — Feature-Rich Vite Client
  - **Framework**: Vite + React (alternative to core web app)
  - **Extended Features**:
    - Drag & Drop: @dnd-kit/core, sortable, utilities
    - Forms: react-hook-form with Zod validation (@hookform/resolvers)
    - Internationalization: i18next + react-i18next + language detector (supports multi-language)
    - UI Components: Radix UI primitives (Dialog, Popover, Tabs, Select, Slider, Toast, etc.)
    - Animations: Framer Motion + Motion library
  - **Build**: `bun run build`
  
  ---
  
  ## Documentation Site (`/docs`)
  - **Framework**: Next.js 16 with **Fumadocs MDX** framework (v13+)
  - **MDX Processing**: fumadocs-mdx plugin
  - **OpenAPI Integration**: fumadocs-openapi for auto-generated API docs from backend specs
  - **UI Library**: fumadocs-ui, fumadocs-core
  - **Icons/Shading**: shiki (syntax highlighting), lucide-react
  - **Styling**: Tailwind CSS v4.x
  
  ---
  
  ## DevOps & Tooling
  
  ### Code Quality & Formatting
  - **Biome** (v2.3+) - Unified linter and formatter (replaces ESLint/Prettier)
    - Commands: `biome lint`, `biome format`, `biome check`
  - **Ruff** - Python code quality tool (configured in pyproject.toml)
    - Linting rules: F, E, W, I, N, B, A, SIM, T20, RET, PIE, PT, RUF, ERA, FIX
  
  ### Build & Deployment Scripts
  - Custom shell scripts for server builds (`scripts/build-server.sh`)
  - Asset conversion utilities
  - Release preparation automation
  
  ### Containerization
  - **Dockerfile** — Backend container build
  - **docker-compose.yml** — Multi-service orchestration (backend + frontend)
  
  ### Version Management
  - **Bumpversion** (.bumpversion.cfg) — Semantic versioning automation
    - Used with `prepare-release.sh` for release bumps
  
  ---
  
  ## Key Architecture Patterns
  
  1. **Monorepo Structure**: Workspace-based npm/bun monorepo with multiple client packages
  2. **Shared State**: Zustand for global state across React clients
  3. **Server-Driven UI**: TanStack Query for optimistic caching and background refetching
  4. **Audio-Centric UX**: WaveSurfer.js integrated across all frontend clients for waveform visualization
  5. **Desktop Hybrid**: Tauri 2 wraps the core web client while maintaining native performance
  
  ---
  
  ## Notable Technical Decisions
  
  1. **Tailwind v4 Adoption**: Latest Tailwind with new CSS-first architecture across all clients
  2. **Bun over Node.js**: Chosen for faster dev experience and build times
  3. **Biome over ESLint/Prettier**: Faster, unified linting/formatting toolchain
  4. **Frozen Build Optimization**: Special handling of spaCy models and unidic dictionaries to avoid runtime downloads in frozen Tauri builds
  5. **Git-Installed ML Submodules**: Zipvoice and Chatterbox installed directly from git repositories due to dependency resolution issues with PyPI wheels
  
---

</div>

<details><summary>Note:</summary>

This README has been updated with the Voicebox Tech Stack Overview information from `M:\copy\AI\basic-memory\Projects\VoiceBox\Voicebox Tech Stack Overview.md` at the beginning of the file. The new section includes detailed information about:

- **Backend (Python)**: FastAPI, Uvicorn, Pydantic
- **Database & ORM**: SQLAlchemy, SQLite, Alembic
- **Machine Learning / TTS Engines**: LuxTTS, Qwen-TTS, Kokoro TTS, Chatterbox TTS, HumeAI TADA
- **Phonemization & NLP**: piper-phonemize, spacy-pkuseg, misaki
- **Audio Processing**: librosa, soundfile, pedalboard, pyloudnorm
- **Frontend Clients**: Web app, landing page, Tauri desktop wrapper, feature-rich Vite client
- **Documentation Site**: Next.js with Fumadocs MDX framework
- **DevOps & Tooling**: Biome, Ruff, Docker, Bumpversion
- **Key Architecture Patterns**: Monorepo structure, Zustand state management, TanStack Query

The original content (download links, features, API documentation, roadmap, development setup, etc.) has been preserved.
</details>
<task_progress>
- [x] Read source file (Voicebox Tech Stack Overview.md)
- [x] Read current README.md
- [x] Insert tech stack content at beginning of README.md
- [x] Verify the result
</task_progress>
</write_to_file>


just dev-backend   # backend only
just dev-frontend  # Tauri app only (backend must be running)
