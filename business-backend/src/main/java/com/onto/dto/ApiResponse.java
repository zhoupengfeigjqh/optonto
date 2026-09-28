package com.onto.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 统一响应信封（章程 VI：统一错误响应格式）。
 *
 * <p>成功：{@code code=0} 且 HTTP 200，{@code data} 承载业务数据；
 * 失败：{@code code != 0}，HTTP 状态码与 {@code code} 一致，错误信息在 {@code message}。
 */
@Schema(description = "统一响应信封：code=0 为成功，非 0 为业务失败（HTTP 状态码与 code 一致）")
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    @Schema(description = "业务状态码，0 表示成功", example = "0")
    private int code;

    @Schema(description = "错误信息（成功时通常省略）", example = "采购单不存在")
    private String message;

    @Schema(description = "业务数据（成功时返回；失败时为 null）")
    private T data;

    public static <T> ApiResponse<T> ok(T data) {
        ApiResponse<T> r = new ApiResponse<>();
        r.code = 0;
        r.data = data;
        return r;
    }

    public static <T> ApiResponse<T> ok(T data, String message) {
        ApiResponse<T> r = ok(data);
        r.message = message;
        return r;
    }

    public static <T> ApiResponse<T> fail(int code, String message) {
        ApiResponse<T> r = new ApiResponse<>();
        r.code = code;
        r.message = message;
        return r;
    }

    public int getCode() { return code; }
    public void setCode(int v) { this.code = v; }
    public String getMessage() { return message; }
    public void setMessage(String v) { this.message = v; }
    public T getData() { return data; }
    public void setData(T v) { this.data = v; }
}
