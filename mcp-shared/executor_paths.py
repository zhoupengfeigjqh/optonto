"""执行底座的 REST 端点路径（**唯一权威来源**）。

**为什么单独一个模块（2026-11-16）**：路径此前以字面量散在 8 处——core 的 4 个 router、
自建发布的转发契约（``publish_upstream``）与 3 个服务端的 ``Route(...)`` 声明。
2026-10-04 的 ``_UPSTREAM`` 副本事故已经证明：同一契约写两遍，漂移时的表现是**运行期静默
404 / 连错服务**，而不是导入错误。故路径收到一处：服务端 Route、门面转发、core 转发都读这里，
改路径只改本文件（外加同批重建镜像，见下）。

**命名口径**：``<动词>-<资源>``，资源名自带命名空间。

- 本体函数 ``/execute-ontology-function``（2026-11-16 由 ``/execute-function`` 更名）：
  ``function`` 一词在本平台有二义（本体函数 vs 公共函数），环境变量名早已消歧为
  ``ONTOLOGY_FUNCTION_EXECUTOR_URL``（见 ``core-backend/tests/test_mcp_service_naming.py``），
  路径当时没跟上；兄弟端点 ``/execute-common-function`` 本来就带命名空间，旧名是四端点里的孤例。
- 行为 / 引擎两个入口沿用 ``call-`` 前缀：它们与自建发布的既成转发契约同形（见
  ``publish_upstream.PUBLISH_UPSTREAMS``），统一动词留待下一次执行底座改动，避免同一批里
  既改语义又改前缀。

**改动后果（务必同批处理）**：路径随镜像烘焙——门面按 kind 读本模块的 ``path`` 转发，
故改路径必须**同批重建** 8005 / 8006 / 8007 / 门面镜像，并**重建所有运行中的自建发布容器**；
否则旧容器仍打旧路径，表现为"函数发布突然全挂"（404）。
"""

# 本体函数执行（8006，零工具）：core 设计器测试与自建发布（kind=ontology_function）的转发目标
EXECUTE_ONTOLOGY_FUNCTION = "/execute-ontology-function"
# 公共函数执行（8007，发布 + 执行一体）：core 设计器测试的转发目标
EXECUTE_COMMON_FUNCTION = "/execute-common-function"
# 本体行为执行（8005，零工具）：自建发布（kind=behavior）与设计器测试的转发目标
CALL_BEHAVIOR = "/call-behavior"
# 数据引擎直调（8005，零工具）：设计器「连接测试」的转发目标
CALL_ENGINE = "/call-engine"

PATHS = (
    EXECUTE_ONTOLOGY_FUNCTION,
    EXECUTE_COMMON_FUNCTION,
    CALL_BEHAVIOR,
    CALL_ENGINE,
)

__all__ = [
    "CALL_BEHAVIOR",
    "CALL_ENGINE",
    "EXECUTE_COMMON_FUNCTION",
    "EXECUTE_ONTOLOGY_FUNCTION",
    "PATHS",
]
