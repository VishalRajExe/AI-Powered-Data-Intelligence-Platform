import logging
from colorama import Fore, Style, init

# Initialize colorama
init(autoreset=True)

class CustomFormatter(logging.Formatter):
    """Custom logging formatter with colors for different log levels."""
    FORMATS = {
        logging.DEBUG: f"{Fore.CYAN}%(asctime)s [DEBUG] %(name)s: %(message)s{Style.RESET_ALL}",
        logging.INFO: f"{Fore.GREEN}%(asctime)s [INFO] %(name)s: %(message)s{Style.RESET_ALL}",
        logging.WARNING: f"{Fore.YELLOW}%(asctime)s [WARNING] %(name)s: %(message)s{Style.RESET_ALL}",
        logging.ERROR: f"{Fore.RED}%(asctime)s [ERROR] %(name)s: %(message)s{Style.RESET_ALL}",
        logging.CRITICAL: f"{Fore.MAGENTA}%(asctime)s [CRITICAL] %(name)s: %(message)s{Style.RESET_ALL}",
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno, "%(asctime)s [LOG] %(name)s: %(message)s")
        formatter = logging.Formatter(log_fmt)
        return formatter.format(record)

def setup_logger(name: str, level: str = "INFO") -> logging.Logger:
    """Sets up a logger with colored output."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Create console handler with the custom formatter
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(CustomFormatter())

    # Add the handler to the logger
    if not logger.handlers:  # Avoid duplicate handlers
        logger.addHandler(console_handler)

    return logger