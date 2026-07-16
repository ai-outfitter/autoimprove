#!/usr/bin/env python3

import importlib.util
import json
import math
import os
import pathlib
import sys

import anchorscad as ad


RESULT_PREFIX = "AUTOIMPROVE_CAD_RESULT="
VERIFIER_STDOUT = sys.stdout


def fail(message: str) -> None:
    raise ValueError(message)


def load_model(path: pathlib.Path):
    spec = importlib.util.spec_from_file_location("candidate_cad_model", path)
    if spec is None or spec.loader is None:
        fail(f"unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def finite_vec3(value, label: str):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        fail(f"{label} must be a vec3")
    result = [float(item) for item in value]
    if not all(math.isfinite(item) for item in result):
        fail(f"{label} must contain finite numbers")
    return result


def close(a: float, b: float, tolerance: float = 1.0e-7) -> bool:
    return abs(a - b) <= tolerance


def inside(path: pathlib.Path, roots: tuple[pathlib.Path, ...]) -> bool:
    return any(path == root or root in path.parents for root in roots)


def install_audit_guard(work_dir: pathlib.Path) -> None:
    read_roots = tuple(
        {work_dir, *(pathlib.Path(item).resolve() for item in sys.path if item)}
    )
    write_roots = (work_dir,)
    write_flags = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND
    blocked = {
        "ctypes.dlopen",
        "ctypes.dlsym",
        "os.exec",
        "os.posix_spawn",
        "os.spawn",
        "os.system",
        "socket.__new__",
        "socket.connect",
        "subprocess.Popen",
    }
    path_events = {
        "os.chdir",
        "os.chmod",
        "os.chown",
        "os.link",
        "os.listdir",
        "os.mkdir",
        "os.remove",
        "os.rename",
        "os.rmdir",
        "os.scandir",
        "os.symlink",
        "os.truncate",
    }

    def guard(event, args):
        if event in blocked:
            raise PermissionError(f"candidate operation blocked: {event}")
        if event == "open" and args and not isinstance(args[0], int):
            path = pathlib.Path(args[0]).resolve()
            mode = args[1] if len(args) > 1 and isinstance(args[1], str) else ""
            flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
            writing = any(character in mode for character in "wax+") or flags & write_flags
            roots = write_roots if writing else read_roots
            if not inside(path, roots):
                raise PermissionError(f"candidate file access blocked: {path}")
        if event in path_events and args and isinstance(args[0], (str, bytes, os.PathLike)):
            roots = read_roots if event in {"os.listdir", "os.scandir"} else write_roots
            paths = [args[0]]
            if event in {"os.link", "os.rename", "os.symlink"} and len(args) > 1:
                paths.append(args[1])
            for value in paths:
                path = pathlib.Path(value).resolve()
                if not inside(path, roots):
                    raise PermissionError(f"candidate path operation blocked: {path}")

    sys.addaudithook(guard)


def native_geometry(entry):
    native_shape = entry.shapeframe.shape
    matrix = entry.shapeframe.reference_frame.A
    translation = [float(matrix[axis, 3]) for axis in range(3)]

    if isinstance(native_shape, ad.Box):
        native_size = [float(value) for value in native_shape.size.A3]
        return {
            "name": entry.shapeframe.name,
            "primitive": "cube",
            "size": native_size,
            "bounds": {
                "min": translation,
                "max": [translation[axis] + native_size[axis] for axis in range(3)],
            },
            "volume": native_size[0] * native_size[1] * native_size[2],
        }

    if isinstance(native_shape, ad.Sphere):
        native_radius = float(native_shape.r)
        return {
            "name": entry.shapeframe.name,
            "primitive": "sphere",
            "radius": native_radius,
            "bounds": {
                "min": [value - native_radius for value in translation],
                "max": [value + native_radius for value in translation],
            },
            "volume": (4.0 / 3.0) * math.pi * native_radius**3,
        }

    fail("AnchorSCAD entries must contain ad.Box or ad.Sphere shapes")


def native_part(part: dict, index: int):
    if not isinstance(part, dict):
        fail(f"parts[{index}] must be a dictionary")
    name = part.get("name")
    primitive = part.get("primitive")
    center_contract = finite_vec3(part.get("center"), f"parts[{index}].center")
    maker = part.get("shape")
    if not isinstance(name, str) or not name:
        fail(f"parts[{index}].name must be a nonempty string")
    if primitive not in ("cube", "sphere"):
        fail(f"parts[{index}].primitive must be cube or sphere")
    if not isinstance(maker, ad.Maker) or len(maker.entries) != 1:
        fail(f"parts[{index}].shape must be an AnchorSCAD Maker with one entry")

    entry = next(iter(maker.entries.values()))
    if entry.shapeframe.name != name:
        fail(f"parts[{index}] name does not match its AnchorSCAD named shape")
    geometry = native_geometry(entry)
    if geometry["primitive"] != primitive:
        fail(f"parts[{index}] declared {primitive} but built {geometry['primitive']}")

    if primitive == "cube":
        size_contract = float(part.get("size"))
        if not math.isfinite(size_contract) or size_contract <= 0:
            fail(f"parts[{index}].size must be positive")
        native_size = geometry["size"]
        if len(native_size) != 3 or not all(close(value, size_contract) for value in native_size):
            fail(f"parts[{index}] ad.Box size does not match its size field")
    else:
        radius_contract = float(part.get("radius"))
        native_radius = geometry["radius"]
        if not math.isfinite(radius_contract) or radius_contract <= 0:
            fail(f"parts[{index}].radius must be positive")
        if not close(native_radius, radius_contract):
            fail(f"parts[{index}] ad.Sphere radius does not match its radius field")

    native_center = [
        (geometry["bounds"]["min"][axis] + geometry["bounds"]["max"][axis]) / 2.0
        for axis in range(3)
    ]
    if not all(close(native_center[axis], center_contract[axis]) for axis in range(3)):
        fail(f"parts[{index}] AnchorSCAD placement does not match its center field")

    rendered = str(ad.render(maker).rendered_shape)
    if not rendered.strip():
        fail(f"parts[{index}] rendered empty AnchorSCAD source")

    return {
        "name": name,
        "primitive": primitive,
        "center": native_center,
        "bounds": geometry["bounds"],
        "volume": geometry["volume"],
    }


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: verify-anchorscad.py <model.py> <task.json> <artifact.scad>")

    model_path = pathlib.Path(sys.argv[1]).resolve()
    task_path = pathlib.Path(sys.argv[2]).resolve()
    artifact_path = pathlib.Path(sys.argv[3]).resolve()
    task_spec = json.loads(task_path.read_text())
    install_audit_guard(model_path.parent)
    module = load_model(model_path)
    build = getattr(module, "build", None)
    if not callable(build):
        fail("model.py must define build(spec)")

    built = build(task_spec)
    if not isinstance(built, dict) or not isinstance(built.get("parts"), list):
        fail("build(spec) must return {'parts': [...], 'preview': Maker}")
    if not built["parts"]:
        fail("build(spec) returned no parts")
    preview = built.get("preview")
    if not isinstance(preview, ad.Maker):
        fail("preview must be an AnchorSCAD Maker")

    parts = [native_part(part, index) for index, part in enumerate(built["parts"])]
    expected_names = {part["name"] for part in parts}
    preview_geometry = [native_geometry(entry) for entry in preview.entries.values()]
    preview_names = {part["name"] for part in preview_geometry}
    if preview_names != expected_names:
        fail("AnchorSCAD preview must preserve every named assembly part exactly once")
    if len(preview_geometry) != len(parts):
        fail("AnchorSCAD preview contains duplicate named assembly parts")
    preview_by_name = {part["name"]: part for part in preview_geometry}
    for part in parts:
        preview_part = preview_by_name[part["name"]]
        if preview_part["primitive"] != part["primitive"]:
            fail(f"AnchorSCAD preview part {part['name']} has the wrong primitive")
        for bound in ("min", "max"):
            if not all(
                close(preview_part["bounds"][bound][axis], part["bounds"][bound][axis])
                for axis in range(3)
            ):
                fail(f"AnchorSCAD preview part {part['name']} has the wrong placement")

    scad = str(ad.render(preview).rendered_shape)
    if not scad.strip():
        fail("AnchorSCAD preview rendered empty source")
    artifact_path.write_text(scad)

    combined = {
        "min": [
            min(part["bounds"]["min"][axis] for part in preview_geometry)
            for axis in range(3)
        ],
        "max": [
            max(part["bounds"]["max"][axis] for part in preview_geometry)
            for axis in range(3)
        ],
    }
    VERIFIER_STDOUT.write(
        RESULT_PREFIX
        + json.dumps(
            {
                "executed": True,
                "artifact": {"path": str(artifact_path), "size": len(scad.encode())},
                "parts": parts,
                "combinedBounds": combined,
            }
        )
        + "\n"
    )
    VERIFIER_STDOUT.flush()


if __name__ == "__main__":
    main()
