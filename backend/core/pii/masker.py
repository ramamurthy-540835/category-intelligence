import re
import logging
from typing import Dict, Any, List, Union
import copy

logger = logging.getLogger(__name__)

class PIIMasker:
    EMAIL_RE = re.compile(r'[\w\.-]+@[\w\.-]+\.\w+')
    PHONE_RE = re.compile(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b')
    SENSITIVE_KEY_TOKENS = {'customer', 'loyalty', 'member', 'email', 'phone', 'name', 'id', 'address', 'dob', 'ssn'}

    def mask_text(self, text: str) -> str:
        try:
            text = self.EMAIL_RE.sub('[REDACTED]', text)
            text = self.PHONE_RE.sub('[REDACTED]', text)
            return text
        except Exception as e:
            logger.error(f"PIIMasker error in mask_text: {e}")
            return text

    def mask_value(self, value: Any) -> Any:
        try:
            if isinstance(value, str):
                return self.mask_text(value)
            elif isinstance(value, dict):
                return self.mask_payload(value)
            elif isinstance(value, list):
                return [self.mask_value(v) for v in value]
            elif isinstance(value, tuple):
                return tuple(self.mask_value(v) for v in value)
            return value
        except Exception as e:
            logger.error(f"PIIMasker error in mask_value: {e}")
            return value

    def mask_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            masked = copy.deepcopy(payload)
            for k, v in masked.items():
                if any(token in k.lower() for token in self.SENSITIVE_KEY_TOKENS):
                    masked[k] = '[REDACTED]'
                else:
                    masked[k] = self.mask_value(v)
            return masked
        except Exception as e:
            logger.error(f"PIIMasker error in mask_payload: {e}")
            return payload
