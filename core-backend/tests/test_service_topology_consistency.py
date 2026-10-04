"""服务拓扑一致性契约（**跨仓静态护栏**，不依赖 Docker 运行态）。

**它防的是什么**：服务更名 / 拆分 / 端口调整时，「代码与文案里的地址」跟不上「compose 里的真名」，
于是出现三类静默故障——

1. 启停 404：前端卡片 `service` 键不在 ``mcp_ctl.MCP_SERVICES`` 白名单里；
2. 连接失败：内网地址指向已不存在的容器名（DNS 解析不了，调用方只看到"连不上"）；
3. 承诺失效：文档/卡片宣称某服务"对外"或"内网"，实际端口暴露面已变。

**为什么放在 core-backend**：``mcp_ctl`` 白名单与自建发布上游表都在这里，由它的测试来守护
"白名单 ⇄ compose ⇄ 上游地址 ⇄ 前端文案 ⇄ 契约文档"这条链的一致性，是唯一能同时看到两侧的地方。

**判定的事实源**（唯一）：``docker-compose.yml`` 的 ``container_name`` / ``ports``，
以及各服务 Dockerfile 的 ``--port``（容器内监听端口）。其余文件都是被校验方。

**何时跳过**：仓库根下找不到 ``docker-compose.yml``（例如只 COPY 了 backend 的精简镜像）时整体跳过——
护栏在完整仓库里才有意义，缺事实源时静默通过比误报更可取。

运行：``cd core-backend && python -m unittest tests.test_service_topology_consistency -v``
"""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"

try:
    import yaml
except ImportError:  # pragma: no cover - 环境缺 PyYAML 时跳过，不误报
    yaml = None

# 固定服务的容器名后缀（compose 里即服务名 = container_name，一一对应）
_MCP_SUFFIXES = ("-mcp", "-executor")
# compose 环境变量里以地址形式注入的键 → 必须指向真实容器
_CORE_ENV_URL_KEYS = (
    "MCP_BUILTIN_URL",
    "MCP_BUILTIN_DATA_ENGINE_URL",
    "MCP_BUILTIN_COMMON_FUNCTION_URL",
    "DATA_ENGINE_EXECUTOR_URL",
    "ONTOLOGY_FUNCTION_EXECUTOR_URL",
    "COMMON_FUNCTION_MCP_URL",
)
# agent 侧「预置/内置服务」的默认地址常量 → 必须指向真实容器
_AGENT_DEFAULT_URL_CONSTS = (
    "DEFAULT_BUILTIN_URL",
    "DEFAULT_DATA_ENGINE_URL",
    "DEFAULT_COMMON_FUNCTION_URL",
)
_URL_RE = re.compile(r"(?:http://)?([a-z0-9-]+):(\d+)(/[^\s\"'`,]*)?")
_URL_STRICT_RE = re.compile(r"^http://([a-z0-9-]+):(\d+)")
_PORT_IN_DOCKERFILE_RE = re.compile(r"--port[\"', ]+(\d+)")


def _load_compose() -> dict:
    if yaml is None or not COMPOSE_FILE.exists():
        return {}
    data = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8")) or {}
    return data.get("services") or {}


def _container_ports(service_cfg: dict) -> list:
    """宿主→容器端口对（兼容 "8002:8002" 字符串与 {published: 8002} 字典两种写法）。"""
    out = []
    for item in service_cfg.get("ports") or []:
        if isinstance(item, str):
            parts = item.split(":")
            if len(parts) >= 2 and parts[-2].isdigit() and parts[-1].split("/")[0].isdigit():
                out.append((int(parts[-2]), int(parts[-1].split("/")[0])))
        elif isinstance(item, dict) and item.get("published"):
            out.append((int(item["published"]), int(item.get("target", item["published"]))))
    return out


def _internal_port(service_name: str, service_cfg: dict) -> int | None:
    """容器内监听端口：取该服务 Dockerfile 的 ``--port N``（无则 EXPOSE，再无则 None）。"""
    build = service_cfg.get("build")
    if not isinstance(build, dict):
        return None
    dockerfile = REPO_ROOT / str(build.get("dockerfile", ""))
    if not dockerfile.exists():
        return None
    text = dockerfile.read_text(encoding="utf-8", errors="replace")
    hit = _PORT_IN_DOCKERFILE_RE.search(text)
    if hit:
        return int(hit.group(1))
    exposed = re.search(r"^\s*EXPOSE\s+(\d+)", text, re.MULTILINE)
    return int(exposed.group(1)) if exposed else None


class TopologyCase(unittest.TestCase):
    """事实源 + 受检文件。"""

    @classmethod
    def setUpClass(cls):
        cls.services = _load_compose()
        if not cls.services:
            raise unittest.SkipTest(f"缺少事实源 {COMPOSE_FILE.name}（精简镜像环境跳过）")
        cls.containers = {
            cfg.get("container_name") or name: name
            for name, cfg in cls.services.items()
            if isinstance(cfg, dict)
        }
        cls.mcp_containers = {
            c: s for c, s in cls.containers.items() if c.endswith(_MCP_SUFFIXES)
        }
        cls.internal = {
            name: _internal_port(name, cfg) for name, cfg in cls.services.items()
            if isinstance(cfg, dict)
        }
        cls.env = {}
        for cfg in cls.services.values():
            if not isinstance(cfg, dict):
                continue
            raw_env = cfg.get("environment") or {}
            # compose 的 environment 有两种写法：映射（KEY: VALUE）与列表（- KEY=VALUE）
            pairs = raw_env.items() if isinstance(raw_env, dict) else (
                (i.split("=", 1)[0], i.split("=", 1)[1]) for i in raw_env
                if isinstance(i, str) and "=" in i)
            for key, value in pairs:
                if isinstance(value, str):
                    cls.env.setdefault(key, value)

    # ── 断言工具 ────────────────────────────────────────────────────────────
    def assert_url_real(self, url: str, where: str, *, require_internal: bool = False):
        """URL 指向真实容器，且端口与该容器的**容器内监听端口**一致。"""
        hit = _URL_RE.search(url)
        self.assertIsNotNone(hit, f"{where}: 无法解析地址 {url!r}")
        host, port = hit.group(1), int(hit.group(2))
        self.assertIn(host, self.containers, f"{where}: 指向不存在的容器 {host!r}（{url}）")
        service = self.containers[host]
        expected = self.internal.get(service)
        self.assertIsNotNone(expected, f"{where}: {service} 的 Dockerfile 未声明 --port，无法校验 {url}")
        self.assertEqual(
            port, expected,
            f"{where}: 端口不符——{url} 用了 {port}，{service} 实际监听 {expected}")
        if require_internal:
            self.assertEqual(
                _container_ports(self.services[service]), [],
                f"{where}: 标注为内网服务，但 compose 发布了宿主端口 {url}")

    def read(self, rel: str) -> str:
        path = REPO_ROOT / rel
        self.assertTrue(path.exists(), f"受检文件缺失: {rel}")
        return path.read_text(encoding="utf-8", errors="replace")


class WhitelistCase(TopologyCase):
    """启停白名单 ⇄ compose：任一侧不同步都会导致 404 或"服务存在但管不了"。"""

    def setUp(self):
        from routers.mcp_ctl import MCP_SERVICES
        self.whitelist = MCP_SERVICES

    def test_白名单容器名都在compose里(self):
        for key, container in self.whitelist.items():
            self.assertIn(container, self.containers, f"服务键 {key} 指向不存在的容器 {container}")
            self.assertEqual(self.containers[container], container,
                             f"{container} 的 container_name 与服务名应一致（compose 约定）")

    def test_compose里的MCP服务全部在白名单(self):
        for container in self.mcp_containers:
            self.assertIn(container, self.whitelist.values(),
                          f"{container} 是 compose 里的 MCP 服务但不在启停白名单——UI 将无法管控它")

    def test_白名单键与前端卡片键一一对应(self):
        """前端每张卡片打来的 service 键必须在白名单里，否则卡片状态永远拿不到（404）。"""
        text = self.read("frontend/src/components/Design/MCPPublish.tsx")
        keys = set(re.findall(r"service:\s*'([a-z-]+)'", text))
        self.assertTrue(keys, "未从 MCPPublish.tsx 解析出任何 service 键（正则需同步）")
        self.assertEqual(keys - set(self.whitelist), set(),
                         "前端卡片使用了白名单外的 service 键")


class UpstreamAddressCase(TopologyCase):
    """所有指向执行底座的内网地址 ⇄ compose 容器真名与真实端口。"""

    def test_自建发布上游地址真实且变量名与门面一致(self):
        """注入方（core）注入的变量名必须**正是**门面读取的那个名字。

        2026-10-04 修复的真实缺陷：两类发布都注入 ONTOLOGY_FUNCTION_EXECUTOR_URL，而门面按 kind
        读两个不同名字——行为类容器带了一个"名为本体函数执行器、实指数据引擎"的死变量，
        真正该读的 DATA_ENGINE_EXECUTOR_URL 从未被注入，行为发布只靠默认值巧合跑通。
        """
        from services.mcp_contract_bridge import env_name_of
        from services.mcp_publish_registry import (
            KIND_BEHAVIOR, KIND_ONTOLOGY_FUNCTION, build_run_kwargs,
        )
        entry = {"name": "t", "ontology_id": 1, "host_port": 8020, "transport": "streamable",
                 "token": "tk", "container_name": "optonto-mcp-publish-t-abc123",
                 "tools": [{"name": "f", "description": "d",
                            "inputSchema": {"type": "object", "properties": {}}}]}
        url_env_keys = {"ONTOLOGY_FUNCTION_EXECUTOR_URL", "DATA_ENGINE_EXECUTOR_URL"}
        for kind in (KIND_ONTOLOGY_FUNCTION, KIND_BEHAVIOR):
            env = build_run_kwargs({**entry, "kind": kind})["environment"]
            injected = url_env_keys & set(env)
            self.assertEqual(len(injected), 1, f"{kind}: 应恰好注入一个上游地址变量，实际 {injected}")
            self.assertEqual(
                next(iter(injected)), env_name_of(kind),
                f"{kind}: 注入的变量名与门面读取名不一致（注入 {injected}，门面读 {env_name_of(kind)}）")
            self.assert_url_real(env[next(iter(injected))], f"自建发布上游({kind})", require_internal=True)

    def test_门面上游表与注入方同源(self):
        """门面不得再自带一份转发契约副本（那正是本次缺陷的成因）。"""
        text = self.read("mcp-publish/server.py")
        self.assertNotIn("_UPSTREAM = {", text, "门面不应自带转发契约副本，请用 mcp-shared/publish_upstream")
        self.assertIn("from publish_upstream import", text)

    def test_compose环境变量地址真实(self):
        for key in _CORE_ENV_URL_KEYS:
            url = self.env.get(key)
            self.assertIsNotNone(url, f"compose 未注入 {key}（服务地址不应硬编码在别处）")
            self.assert_url_real(url, f"compose env {key}")

    def test_agent预置服务默认地址真实(self):
        text = self.read("agent-backend/src/services/mcp-config-store.ts")
        for const in _AGENT_DEFAULT_URL_CONSTS:
            hit = re.search(rf"{const}\s*=\s*'([^']+)'", text)
            self.assertIsNotNone(hit, f"mcp-config-store.ts 缺少 {const}")
            self.assert_url_real(hit.group(1), f"agent {const}")

    def test_公共函数迁移后旧端点只允许出现在归位说明里(self):
        """/execute-common-function 已迁至 8007；8006 的**端点清单**里不得再宣称它。

        只校验 endpoints 数组本身（说明文案里提到"已迁至 8007"是正确的引导，不算漂移）。
        """
        text = self.read("frontend/src/components/Design/MCPPublish.tsx")
        block = re.search(r"def\.key === 'functionExecutor'\)\s*\{(.*?)\n    \}", text, re.DOTALL)
        self.assertIsNotNone(block, "未找到本体函数执行服务的配置分支")
        listed = re.search(r"endpoints:\s*\[([^\]]*)\]", block.group(1))
        self.assertIsNotNone(listed, "本体函数执行服务的配置缺少 endpoints 清单")
        endpoints = re.findall(r"/([a-z-]+)", listed.group(1))
        self.assertEqual(endpoints, ["execute-function"],
                         f"本体函数执行服务的端点清单应只含 execute-function，实际 {endpoints}")


class SurfaceClaimCase(TopologyCase):
    """卡片与文档对"暴露面/端口"的声明 ⇄ compose 实际暴露面。"""

    def test_前端对外端点必须有对应宿主端口(self):
        text = self.read("frontend/src/components/Design/MCPPublish.tsx")
        published = {h for cfg in self.services.values() if isinstance(cfg, dict)
                     for h, _ in _container_ports(cfg)}
        endpoints = re.findall(r"endpoint:\s*'([^']+)'", text)
        self.assertTrue(endpoints, "未解析到任何 endpoint 声明")
        checked = 0
        for raw in endpoints:
            hit = re.search(r"\{host\}:(\d+)", raw)  # 端口为占位符的模板不在此列（自建发布按用户选择）
            if not hit:
                continue  # 内网地址在下一条断言里查
            port = int(hit.group(1))
            self.assertIn(port, published,
                          f"卡片对外公布 {raw}，但 compose 未发布该宿主端口（外网连不上）")
            checked += 1
        self.assertGreater(checked, 0, "未解析到任何对外端点声明（正则需同步）")

    def test_前端内网端点不得对外发布端口(self):
        text = self.read("frontend/src/components/Design/MCPPublish.tsx")
        checked = 0
        for raw in re.findall(r"endpoint:\s*'([^']+)'", text):
            if "{host}" in raw or "内网" not in raw:
                continue
            self.assert_url_real(raw, f"前端内网端点 {raw}", require_internal=True)
            checked += 1
        self.assertGreater(checked, 0, "未解析到任何内网端点声明（正则需同步）")

    def test_契约文档服务表与compose双向对齐(self):
        """漏写一个服务、改错一个容器名都会在这里暴露（文档是协议事实源）。"""
        text = self.read("specs/contracts/mcp-tools.md")
        table = text.split("## 2.")[0]  # §1 服务分工表
        self.assertTrue(table, "契约文档缺少 §1 服务分工")
        for container in self.mcp_containers:
            self.assertIn(container, table, f"契约文档 §1 未列出 {container}（文档是协议事实源）")
        for token in set(re.findall(r"`(optonto-[a-z0-9-]+)`", table)):
            self.assertIn(token, self.containers, f"契约文档 §1 提到不存在的容器 {token}")


if __name__ == "__main__":
    unittest.main()
