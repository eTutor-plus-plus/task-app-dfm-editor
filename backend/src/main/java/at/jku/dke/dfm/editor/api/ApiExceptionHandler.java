package at.jku.dke.dfm.editor.api;

import at.jku.dke.dfm.core.parser.DfmParseException;
import at.jku.dke.dfm.editor.security.RequestSizeLimitFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(DfmParseException.class)
    public ResponseEntity<ParseError> handleParseException(DfmParseException exception) {
        Integer line = exception.getLine() > 0 ? exception.getLine() : null;
        Integer column = exception.getColumn() > 0 ? exception.getColumn() : null;
        return ResponseEntity.badRequest()
            .body(new ParseError(exception.getMessage(), line, column));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ParseError> handleUnreadable(HttpMessageNotReadableException exception) {
        boolean tooLarge = exception.getCause() instanceof RequestSizeLimitFilter.RequestTooLargeException;
        return ResponseEntity.status(tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST)
            .body(new ParseError(tooLarge ? "Request body too large." : "Request body could not be read.", null, null));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ParseError> handleUnexpected(Exception exception) throws Exception {
        if (exception instanceof ErrorResponse) {
            throw exception;
        }
        LOGGER.error("Unexpected error while handling request", exception);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ParseError("Internal server error.", null, null));
    }

    public record ParseError(String message, Integer line, Integer column) {
    }
}
