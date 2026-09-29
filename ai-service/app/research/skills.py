"""SKILL.md playbooks — how a known site lays out its pages.

Ported from `web-agent-main/agent-core/src/skills/{parser,discovery,tools}.ts`. Three
differences, each deliberate:

* **No `gray-matter`, no YAML dependency.** Upstream parses frontmatter with a library;
  here the subset the format actually needs — scalars, inline lists and block lists — is
  parsed directly. A dependency bought for six key names is not worth shipping.
* **Upstream's skills are not copied.** Its six playbooks (competitor-analysis,
  deep-research, e-commerce, financial-research, pricing-tracker, structured-extraction)
  describe *its* demo targets. The reuse licence for that repo covers code patterns, not a
  standing endorsement of its content, and a playbook naming sources this platform has
  never verified would become an unsourced default — the exact thing
  `docs/audit/00-FORENSIC-AUDIT.md` §4 was written about. `SKILLS_DIR` points at a
  directory this deployment owns, and an empty one is a valid configuration.
* **Playbooks load deterministically, not by model request.** Upstream gives the agent
  `load_skill` and `lookup_site_playbook` tools and hopes it calls them. Here the match is
  made by the URLs the run has actually observed, so guidance appears exactly when the run
  touches that domain and costs no model turn.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

logger = logging.getLogger("finalagent.skills")

SKILL_FILE = "SKILL.md"
KNOWN_KEYS = ("name", "description", "category", "model", "domains", "platform")
_SLUG = re.compile(r"[^a-z0-9]+")
_ABSOLUTE_DRIVE = re.compile(r"^[A-Za-z]:")


class SkillAccessDenied(RuntimeError):
    """A resource path resolved outside the skill directory that named it."""


@dataclass(slots=True)
class SkillFrontmatter:
    name: str = ""
    description: str = ""
    category: str | None = None
    model: str | None = None
    domains: list[str] = field(default_factory=list)
    platform: str | None = None


@dataclass(slots=True)
class SitePlaybook:
    name: str
    platform: str
    domains: list[str]
    path: Path
    body: str


@dataclass(slots=True)
class Skill:
    name: str
    slug: str
    description: str
    directory: Path
    body: str
    category: str | None = None
    model: str | None = None
    resources: list[str] = field(default_factory=list)
    site_playbooks: list[SitePlaybook] = field(default_factory=list)


@dataclass(slots=True)
class SkillValidation:
    valid: bool
    name: str
    slug: str
    description: str
    errors: list[str]


def slugify(name: str) -> str:
    """`parser.ts:44-47` — lowercase, non-alphanumerics to single hyphens, trimmed."""
    return _SLUG.sub("-", (name or "").lower()).strip("-")


def _scalar(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        return text[1:-1]
    return text


def parse_frontmatter(content: str) -> tuple[dict[str, object], str]:
    """Split a leading `---` frontmatter block from the body.

    Accepts `key: value`, `key: [a, b]` and indented `- item` blocks. Anything else inside
    the block is ignored rather than guessed at, and reported in the log: a playbook with
    unsupported syntax should degrade to "no metadata", not to a wrong one.
    """
    lines = content.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, content.strip()

    data: dict[str, object] = {}
    index = 1
    pending_list_key: str | None = None
    closed_at: int | None = None

    while index < len(lines):
        raw = lines[index]
        stripped = raw.strip()
        if stripped == "---":
            closed_at = index
            index += 1
            break
        if not stripped or stripped.startswith("#"):
            index += 1
            continue

        if stripped.startswith("- ") and pending_list_key is not None:
            data.setdefault(pending_list_key, [])
            if isinstance(data[pending_list_key], list):
                cast: list[str] = data[pending_list_key]  # type: ignore[assignment]
                cast.append(_scalar(stripped[2:]))
            index += 1
            continue

        if ":" not in stripped:
            logger.warning("ignoring unsupported skill frontmatter line: %s", stripped[:60])
            pending_list_key = None
            index += 1
            continue

        key, _, value = stripped.partition(":")
        key, value = key.strip(), value.strip()
        pending_list_key = None
        if value == "":
            pending_list_key = key
            data[key] = []
        elif value.startswith("[") and value.endswith("]"):
            data[key] = [_scalar(item) for item in value[1:-1].split(",") if item.strip()]
        else:
            data[key] = _scalar(value)
        index += 1

    if closed_at is None:
        # No closing fence: treat the whole file as body, as an unterminated block is not
        # frontmatter but prose that happens to start with three dashes.
        return {}, content.strip()

    body = "\n".join(lines[index:])
    unknown = [key for key in data if key not in KNOWN_KEYS]
    if unknown:
        logger.warning("skill frontmatter declares unknown keys and they are ignored: %s", unknown)
    return data, body.strip()


def parse_skill_frontmatter(content: str) -> SkillFrontmatter:
    data, _ = parse_frontmatter(content)

    def text(key: str) -> str | None:
        value = data.get(key)
        return value if isinstance(value, str) and value else None

    domains = data.get("domains")
    return SkillFrontmatter(
        name=text("name") or "",
        description=text("description") or "",
        category=text("category"),
        model=text("model"),
        domains=[str(item) for item in domains] if isinstance(domains, list) else [],
        platform=text("platform"),
    )


def validate_skill_content(content: str) -> SkillValidation:
    """`parser.ts:37-54` — name and description required, body must not be empty."""
    meta = parse_skill_frontmatter(content)
    errors: list[str] = []
    if not meta.name:
        errors.append("Missing required field: name")
    if not meta.description:
        errors.append("Missing required field: description")

    slug = slugify(meta.name)
    if meta.name and not slug:
        errors.append("Name produces empty slug")

    _, body = parse_frontmatter(content)
    if not body:
        errors.append("Empty body (no content after frontmatter)")

    return SkillValidation(
        valid=not errors,
        name=meta.name,
        slug=slug,
        description=meta.description,
        errors=errors,
    )


def _discover_site_playbooks(skill_dir: Path) -> list[SitePlaybook]:
    sites_dir = skill_dir / "sites"
    if not sites_dir.is_dir():
        return []

    playbooks: list[SitePlaybook] = []
    for path in sorted(sites_dir.glob("*.md")):
        try:
            content = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("unreadable site playbook %s: %s", path.name, exc)
            continue
        meta = parse_skill_frontmatter(content)
        if not meta.domains:
            continue
        _, body = parse_frontmatter(content)
        playbooks.append(
            SitePlaybook(
                name=path.stem,
                platform=meta.platform or path.stem,
                domains=[domain.lower() for domain in meta.domains],
                path=path,
                body=body,
            )
        )
    return playbooks


@dataclass(slots=True)
class Discovery:
    skills: list[Skill]
    rejected: dict[str, list[str]] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.skills)


def discover_skills(skills_dir: Path | str) -> Discovery:
    """Read every `<dir>/<skill>/SKILL.md`.

    Upstream swallows a bad skill silently (`discovery.ts:71-73`); here the reason is
    returned so the health endpoint, the tests and the operator can all see that a playbook
    they expected to apply does not.
    """
    directory = Path(skills_dir)
    if not directory.is_dir():
        return Discovery(skills=[])

    discovery = Discovery(skills=[])
    for entry in sorted(directory.iterdir()):
        if not entry.is_dir():
            continue
        skill_file = entry / SKILL_FILE
        if not skill_file.is_file():
            continue
        try:
            content = skill_file.read_text(encoding="utf-8")
        except OSError as exc:
            discovery.rejected[entry.name] = [f"unreadable: {exc}"]
            continue

        validation = validate_skill_content(content)
        if not validation.valid:
            discovery.rejected[entry.name] = validation.errors
            continue

        meta = parse_skill_frontmatter(content)
        _, body = parse_frontmatter(content)
        resources = sorted(
            item.name
            for item in entry.iterdir()
            if item.is_file() and item.name != SKILL_FILE and not item.name.startswith(".")
        )
        discovery.skills.append(
            Skill(
                name=meta.name or entry.name,
                slug=validation.slug or slugify(entry.name),
                description=validation.description,
                directory=entry,
                body=body,
                category=meta.category,
                model=meta.model,
                resources=resources,
                site_playbooks=_discover_site_playbooks(entry),
            )
        )
    return discovery


def domain_of(url: str) -> str:
    """`tools.ts:66-71` — accept a bare domain or a full URL, lowercase the host."""
    candidate = (url or "").strip()
    if not candidate:
        return ""
    try:
        parsed = urlparse(candidate if candidate.startswith("http") else f"https://{candidate}")
        host = (parsed.netloc or "").split("@")[-1].split(":")[0].lower()
        return host or candidate.lower()
    except ValueError:
        return candidate.lower()


@dataclass(slots=True)
class PlaybookMatch:
    skill: Skill
    playbook: SitePlaybook


def build_domain_index(skills: Iterable[Skill]) -> dict[str, PlaybookMatch]:
    index: dict[str, PlaybookMatch] = {}
    for skill in skills:
        for playbook in skill.site_playbooks:
            for domain in playbook.domains:
                index.setdefault(domain.lower(), PlaybookMatch(skill=skill, playbook=playbook))
    return index


def lookup_playbook(index: dict[str, PlaybookMatch], url: str) -> PlaybookMatch | None:
    """Exact host, then `www.`-stripped, then a registrable-suffix match (`tools.ts:73-80`)."""
    host = domain_of(url)
    if not host:
        return None
    stripped = host.removeprefix("www.")
    match = index.get(host) or index.get(stripped)
    if match is not None:
        return match
    for domain, candidate in index.items():
        if host.endswith(domain) or stripped.endswith(domain):
            return candidate
    return None


class SkillLibrary:
    """The playbooks available to a process, re-read only on demand."""

    def __init__(self, skills_dir: Path | str) -> None:
        self.skills_dir = Path(skills_dir)
        self.skills: list[Skill] = []
        self.rejected: dict[str, list[str]] = {}
        self._index: dict[str, PlaybookMatch] = {}
        self.refresh()

    def refresh(self) -> Discovery:
        discovery = discover_skills(self.skills_dir)
        self.skills = discovery.skills
        self.rejected = discovery.rejected
        self._index = build_domain_index(self.skills)
        if discovery.rejected:
            for name, errors in discovery.rejected.items():
                logger.warning("skill %s was rejected: %s", name, "; ".join(errors))
        return discovery

    @property
    def catalog(self) -> str:
        if not self.skills:
            return ""
        return "\n".join(f"- {skill.name}: {skill.description.strip()}" for skill in self.skills)

    def playbook_bodies_for(self, urls: Iterable[str]) -> list[tuple[str, str]]:
        """Playbooks matching any URL seen this run, de-duplicated, in first-seen order."""
        found: list[tuple[str, str]] = []
        seen: set[str] = set()
        for url in urls:
            match = lookup_playbook(self._index, url)
            if match is None:
                continue
            key = str(match.playbook.path)
            if key in seen:
                continue
            seen.add(key)
            found.append((f"{match.playbook.platform} ({match.skill.name})", match.playbook.body))
        return found

    def read_resource(self, skill_name: str, relative_file: str) -> str:
        """Read a file inside a skill directory, refusing to escape it.

        `tools.ts:107-110` guards with `path.resolve` + `startsWith`. The same check is
        done on resolved `Path`s here, which also catches the `a/../b` forms a string prefix
        test can wave through when directory names share a prefix. Absolute paths are
        refused outright: a skill resource is named relative to its skill, and accepting
        anything else would make the guard the only thing between the caller and the disk.
        """
        skill = next((item for item in self.skills if item.name == skill_name), None)
        if skill is None:
            raise KeyError(f"Skill '{skill_name}' not found")

        normalised = relative_file.replace("\\", "/")
        if normalised.startswith("/") or _ABSOLUTE_DRIVE.match(normalised):
            raise SkillAccessDenied("Access denied: skill resources are named by relative path")

        root = skill.directory.resolve()
        candidate = (root / PurePosixPath(normalised)).resolve()
        if root != candidate and root not in candidate.parents:
            raise SkillAccessDenied("Access denied: path traversal detected")
        if not candidate.is_file():
            raise FileNotFoundError(
                f"File '{relative_file}' not found. Available: {', '.join(skill.resources) or '(none)'}"
            )
        return candidate.read_text(encoding="utf-8")
