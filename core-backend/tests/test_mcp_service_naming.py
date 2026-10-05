# -*- coding: utf-8 -*-
"""MCP 服务命名与转发目标一致性测试（2026-10-04 架构重构的护栏）。

拆分后：本体查询服务（对外）/ 本体函数执行服务（内网，零工具）/ 数据引擎执行服务（内网）。
本测试锁死三件事，防止再次出现"改名漏改"导致的运行期 ImportError / 转发到已下线容器：

1. **转发变量名一致**：routers 里 import 的名字必须在 runtime_forward 里真实存在
   （上次重构就漏了 behaviors.py / data_engines.py，运行期才炸 500）；
2. **固定服务白名单与 compose 容器名一致**：管控面能操作的容器必须真实存在于编排里；
3. **执行底座常量指向执行服务**（不是查询服务），且不含任何对外端口。
"""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent

# 执行底座的规范地址（拆分后的唯一实现）
FUNCTION_EXECUTOR_URL = "http://optonto-ontology-function-executor:8006"
DATA_ENGINE_EXECUTOR_URL = "http://optonto-data-engine-executor:8005"
COMMON_FUNCTION_MCP_URL = "http://optonto-common-function-mcp:8007"
QUERY_MCP_URL = "http://optonto-ontology-query-mcp:8002"


class ForwardTargetCase(unittest.TestCase):
    def test_runtime_forward_导出执行服务地址(self):
        from services import runtime_forward
        self.assertEqual(runtime_forward.ONTOLOGY_FUNCTION_EXECUTOR_URL, FUNCTION_EXECUTOR_URL)
        self.assertEqual(runtime_forward.DATA_ENGINE_EXECUTOR_URL, DATA_ENGINE_EXECUTOR_URL)
        self.assertEqual(runtime_forward.COMMON_FUNCTION_MCP_URL, COMMON_FUNCTION_MCP_URL)
        # 旧变量名必须已消失（残留会让"看起来改了、实际没改"）
        self.assertFalse(hasattr(runtime_forward, "ONTOLOGY_MCP_URL"),
                         "旧的 ONTOLOGY_MCP_URL 应随服务拆分移除")
        self.assertFalse(hasattr(runtime_forward, "DATA_ENGINE_MCP_URL"),
                         "旧的 DATA_ENGINE_MCP_URL 应随服务更名移除")
        self.assertFalse(hasattr(runtime_forward, "FUNCTION_EXECUTOR_URL"),
                         "FUNCTION_EXECUTOR_URL 有二义（本体函数 vs 公共函数），应改为 ONTOLOGY_FUNCTION_EXECUTOR_URL")

    def test_routers_import的转发变量真实存在(self):
        """所有 `from services.runtime_forward import X` 的 X 必须在该模块真实定义。

        这条断言挡住"改名漏改"：漏改在运行期才炸（ImportError → 500），测试期即暴露。
        """
        from services import runtime_forward
        available = {n for n in dir(runtime_forward) if n.isupper()}
        # 只取 import 那一行（单行 import，不跨行），逐个标识符校验
        pattern = re.compile(r"from\s+services\.runtime_forward\s+import\s+([A-Za-z_][A-Za-z0-9_,\s]*)")
        checked = 0
        for path in (BACKEND / "routers").glob("*.py"):
            for line in path.read_text(encoding="utf-8").splitlines():
                m = pattern.search(line)
                if not m:
                    continue
                for name in [n.strip() for n in m.group(1).split(",") if n.strip()]:
                    if name == "forward_call":
                        continue
                    checked += 1
                    self.assertIn(name, available, f"{path.name} 导入了不存在的 {name}")
        self.assertGreater(checked, 0, "未匹配到任何转发导入（正则失效？）")


class FixedServiceRegistryCase(unittest.TestCase):
    def test_白名单键与容器名(self):
        from routers.mcp_ctl import MCP_SERVICES
        self.assertEqual(MCP_SERVICES, {
            "ontology-query": "optonto-ontology-query-mcp",
            "common-function": "optonto-common-function-mcp",
            "function-executor": "optonto-ontology-function-executor",
            "data-engine": "optonto-data-engine-executor",
            "business": "optonto-business-mcp",
        })

    def test_业务系统MCP已纳入管控(self):
        """2026-10-04 用户决策：业务系统 MCP 与其他固定服务同权，可启停。

        此前它是唯一"只读"服务（不在白名单、只能 Docker 手动启停）。
        """
        from routers.mcp_ctl import _container_name
        self.assertEqual(_container_name("business"), "optonto-business-mcp")

    def test_白名单外的键仍被拒(self):
        """第一层防护不变：docker.sock 等价宿主机 root，收不到任意容器名。

        2026-10-05：错误出口由 HTTPException 统一为领域异常（章程 II），
        语义不变——仍是 404（NotFoundError.status_code == 404）。
        """
        from errors import NotFoundError
        from routers.mcp_ctl import _container_name
        for bad in ("published", "unknown", "ontology-mcp", "optonto-mysql", ""):
            with self.subTest(bad=bad):
                with self.assertRaises(NotFoundError) as err:
                    _container_name(bad)
                self.assertEqual(err.exception.status_code, 404)

    def test_不再保留business特例路由(self):
        """特例的 /business/status 路由已并入白名单通配路由——避免两套状态口径。"""
        from routers import mcp_ctl
        paths = {r.path for r in mcp_ctl.router.routes}
        self.assertIn("/api/mcp/{service}/status", paths)
        self.assertNotIn("/api/mcp/business/status", paths)

    def test_执行底座不出现在发布镜像白名单之外(self):
        from services import mcp_publish_registry as reg
        # 动态创建只允许自建发布门面镜像，且保留名不得包含执行底座的可创建副本
        self.assertEqual(reg.IMAGE, "optonto-mcp-publish")
        for name in ("optonto-ontology-query-mcp", "optonto-common-function-mcp",
                      "optonto-ontology-function-executor", "optonto-data-engine-executor"):
            self.assertIn(name, reg.RESERVED_CONTAINER_NAMES)


class ComposeCase(unittest.TestCase):
    def _compose_text(self) -> str:
        return (REPO / "docker-compose.yml").read_text(encoding="utf-8")

    def test_执行底座不发布宿主端口(self):
        text = self._compose_text()
        for service in ("optonto-ontology-function-executor", "optonto-data-engine-executor"):
            start = text.index(f"  {service}:")
            end = text.index("\n  optonto-", start + 5) if "\n  optonto-" in text[start + 5:] else len(text)
            block = text[start:end]
            self.assertNotIn("ports:", block, f"{service} 是内网执行底座，不应发布宿主端口")

    def test_查询服务保留8002对外(self):
        text = self._compose_text()
        start = text.index("  optonto-ontology-query-mcp:")
        block = text[start:start + 700]
        self.assertIn("8002:8002", block)
        self.assertIn("ontology-query-mcp/Dockerfile", block)

    def test_函数执行服务使用8006(self):
        text = self._compose_text()
        self.assertIn("optonto-ontology-function-executor:", text)
        self.assertIn("ontology-function-executor/Dockerfile", text)
        self.assertNotIn('"8006:8006"', text, "8006 只在容器内使用，不发布宿主端口")

    def test_公共函数服务对外发布8007(self):
        text = self._compose_text()
        self.assertIn("optonto-common-function-mcp:", text)
        self.assertIn("common-function-mcp/Dockerfile", text)
        self.assertIn("8007:8007", text, "公共函数 MCP 服务是对外发布面，必须有宿主端口")


if __name__ == "__main__":
    unittest.main()