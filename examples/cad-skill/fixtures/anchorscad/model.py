import anchorscad as ad


def _shape(part):
    center = tuple(part["center"])
    # AnchorSCAD stores the inverse placement frame on named shapes.
    placement = ad.translate(tuple(-value for value in center))
    if part["primitive"] == "cube":
        size = part["size"]
        return ad.Box((size, size, size)).solid(part["name"]).at(
            "centre", pre=placement
        )
    if part["primitive"] == "sphere":
        return ad.Sphere(part["radius"]).solid(part["name"]).at(
            "centre", pre=placement
        )
    raise ValueError(f"unsupported primitive: {part['primitive']}")


def build(spec):
    parts = []
    for part_spec in spec["parts"]:
        part = dict(part_spec)
        part["shape"] = _shape(part_spec)
        parts.append(part)

    preview = _shape(spec["parts"][0])
    for part_spec in spec["parts"][1:]:
        preview.add(_shape(part_spec))
    return {"parts": parts, "preview": preview}
