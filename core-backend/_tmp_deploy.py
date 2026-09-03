import json
import urllib.request

req = urllib.request.Request(
    "http://localhost:8001/api/ontologies/1/deploy/deploy",
    data=json.dumps({"version": "v1.1"}, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=60) as r:
    print(json.dumps(json.load(r), ensure_ascii=False, indent=2))
