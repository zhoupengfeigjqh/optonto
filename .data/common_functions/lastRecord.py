"""公共函数：最新记录。按日期属性取日期最大的一条记录。

日期属性名由调用方用 dateField 指定（本函数不猜字段名）；无法解析为日期的记录忽略。
支持 yyyy-MM-dd、yyyy/MM/dd、ISO 8601（含 T/时区/Z）与秒级时间戳；
带时区偏移的时间折算为 UTC 后比较；多处并列最大日期时取数组中**靠前**的一条。

注意：import 与 helper 必须定义在 run() 内部——core 端 exec 执行时 globals/locals 分离，
模块级 import 的符号对函数体不可见。
"""


def run(params: dict) -> dict:
    """取日期属性最大的那条记录"""
    from datetime import datetime, date, timezone

    def to_datetime(value):
        """日期归一：datetime/date/ISO 字符串/秒级时间戳 → naive datetime；不可解析 → None"""
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, date):
            return datetime(value.year, value.month, value.day)
        elif isinstance(value, (int, float)):
            try:
                return datetime.fromtimestamp(float(value), timezone.utc).replace(tzinfo=None)
            except (ValueError, OverflowError, OSError):
                return None
        elif isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                parsed = None
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
                            "%Y/%m/%d %H:%M:%S", "%Y/%m/%d", "%Y%m%d"):
                    try:
                        parsed = datetime.strptime(text, fmt)
                        break
                    except ValueError:
                        continue
                if parsed is None:
                    return None
        else:
            return None
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed

    def to_json_serializable(obj):
        """记录内的 datetime/date 转 ISO 字符串，保证返回值可 JSON 序列化"""
        if isinstance(obj, dict):
            return {key: to_json_serializable(value) for key, value in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [to_json_serializable(item) for item in obj]
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return obj

    try:
        data = params.get("data") or []
        date_field = params.get("dateField")

        if not data:
            return {"success": False, "data": None, "error": {"code": "EMPTY_DATA", "message": "数据为空"}}
        if not date_field:
            return {"success": False, "data": None,
                    "error": {"code": "FIELD_REQUIRED", "message": "缺少日期属性名 dateField"}}

        hit = False
        latest = None
        latest_at = None
        for record in data:
            if not isinstance(record, dict) or date_field not in record:
                continue
            hit = True
            moment = to_datetime(record[date_field])
            if moment is None:
                continue
            if latest_at is None or moment > latest_at:
                latest = record
                latest_at = moment

        if not hit:
            return {"success": False, "data": None,
                    "error": {"code": "FIELD_NOT_FOUND", "message": f"字段 '{date_field}' 不存在"}}
        if latest is None:
            return {"success": False, "data": None,
                    "error": {"code": "NO_VALID_DATE", "message": f"字段 '{date_field}' 没有可解析的日期"}}

        return {"success": True,
                "data": {"record": to_json_serializable(latest), "date": latest_at.isoformat()},
                "error": None}

    except Exception:
        raise  # 未预期异常上抛 → MCP 层置 isError（报错预算/重试通道），不吞成业务失败
