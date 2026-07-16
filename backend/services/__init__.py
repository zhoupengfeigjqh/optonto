"""Service for reading/writing ontology YAML files."""

from pathlib import Path
from typing import Optional

import yaml

from config import ONTO_MARKET_DIR
from schemas import OntologyData


def _get_ontology_dir(scenario_name: str, ontology_name: str) -> Path:
    """Get the directory path for an ontology's YAML files."""
    return ONTO_MARKET_DIR / scenario_name / ontology_name


def _get_yaml_path(scenario_name: str, ontology_name: str) -> Path:
    """Get the path to the ontology YAML file."""
    return _get_ontology_dir(scenario_name, ontology_name) / "ontology.yaml"


def ensure_ontology_dir(scenario_name: str, ontology_name: str) -> Path:
    """Ensure the ontology directory exists and return its path."""
    dir_path = _get_ontology_dir(scenario_name, ontology_name)
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path


def load_ontology_data(scenario_name: str, ontology_name: str) -> OntologyData:
    """Load ontology data from YAML file. Returns empty data if file doesn't exist."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    if not yaml_path.exists():
        return OntologyData()

    with open(yaml_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    return OntologyData(**raw)


def save_ontology_data(scenario_name: str, ontology_name: str, data: OntologyData) -> None:
    """Save ontology data to YAML file."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    ensure_ontology_dir(scenario_name, ontology_name)

    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(
            data.model_dump(exclude_none=True),
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )


def read_yaml_raw(scenario_name: str, ontology_name: str) -> Optional[str]:
    """Read YAML file content as raw string."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    if not yaml_path.exists():
        return None
    with open(yaml_path, "r", encoding="utf-8") as f:
        return f.read()


def write_yaml_raw(scenario_name: str, ontology_name: str, content: str) -> None:
    """Write raw YAML string to file, then parse and return the structured data."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    ensure_ontology_dir(scenario_name, ontology_name)
    with open(yaml_path, "w", encoding="utf-8") as f:
        f.write(content)


def list_ontology_yaml_files(scenario_name: str, ontology_name: str) -> list[dict]:
    """List all YAML files in the ontology directory."""
    dir_path = _get_ontology_dir(scenario_name, ontology_name)
    if not dir_path.exists():
        return []
    files = []
    for f in sorted(dir_path.iterdir()):
        if f.is_file() and f.suffix in (".yaml", ".yml"):
            files.append({"name": f.name, "path": str(f.relative_to(ONTO_MARKET_DIR))})
    return files
