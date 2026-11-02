import re

ATS_BRANCHES = {
    "1": "Downtown",
    "2": "CentralStore",
    "3": "WestMall",
    "4": "BranchAlpha",
}
_SHOP_NUMBER = re.compile(r"(?:branch|shop|store)\s*-\s*([1-4])", re.IGNORECASE)


def normalize_ats_branch(shop: object) -> str | None:
    match = _SHOP_NUMBER.search(str(shop).strip())
    return ATS_BRANCHES.get(match.group(1)) if match else None
