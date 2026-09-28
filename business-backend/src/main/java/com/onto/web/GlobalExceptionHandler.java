package com.onto.web;

import com.onto.dto.ApiResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * 全局异常处理（章程 VI：统一错误响应格式 + REST 语义正确）。
 *
 * 约定：所有异常一律折叠为 ApiResponse{code,message}，HTTP 状态码与 code 语义一致，
 * 不再出现「code=404 但 HTTP=200」或 Spring 默认 /error 裸结构。
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    /** 非法的业务入参 → 400 */
    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<ApiResponse<Void>> handleBadRequest(RuntimeException e) {
        String message = (e.getMessage() == null || e.getMessage().isEmpty()) ? "请求参数不合法" : e.getMessage();
        return ResponseEntity.badRequest().body(ApiResponse.fail(HttpStatus.BAD_REQUEST.value(), message));
    }

    /** 唯一约束/外键等数据完整性冲突 → 409（并发下由唯一索引兜底时命中） */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleConflict(DataIntegrityViolationException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.fail(HttpStatus.CONFLICT.value(), "数据冲突，请重试"));
    }

    /** 乐观锁冲突（并发修改同一聚合根）→ 409，避免静默的丢失更新（章程 VI） */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleOptimisticLock(ObjectOptimisticLockingFailureException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.fail(HttpStatus.CONFLICT.value(), "并发冲突：数据已被其他请求修改，请重试"));
    }

    /** 兜底 → 500，对外不泄漏内部细节 */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail(HttpStatus.INTERNAL_SERVER_ERROR.value(), "服务器内部错误"));
    }

    /** Spring MVC 标准异常（404/405/415 等）也统一成 ApiResponse，保留其语义状态码 */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, @Nullable Object body, HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        int code = statusCode.value();
        String message = (ex.getMessage() == null || ex.getMessage().isEmpty()) ? "请求处理失败" : ex.getMessage();
        return new ResponseEntity<>(ApiResponse.fail(code, message), headers, statusCode);
    }
}
