package com.nat.base;

import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.edge.EdgeDriver;
import org.openqa.selenium.edge.EdgeOptions;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;

/**
 * Thread-safe WebDriver factory for parallel test execution.
 * Uses ThreadLocal to ensure each thread gets its own driver instance.
 *
 * <p>Usage in tests:
 * <pre>
 * WebDriver driver = DriverFactory.getDriver();
 * // ... run test ...
 * DriverFactory.quitDriver();
 * </pre>
 */
public class DriverFactory {

    private static final Logger log = LoggerFactory.getLogger(DriverFactory.class);
    private static final ThreadLocal<WebDriver> driverThreadLocal = new ThreadLocal<>();

    private DriverFactory() {
        // Utility class — do not instantiate
    }

    /**
     * Returns the WebDriver for the current thread.
     * Creates a new driver if one does not already exist.
     *
     * @return the thread-local WebDriver instance
     */
    public static WebDriver getDriver() {
        if (driverThreadLocal.get() == null) {
            String browser = System.getProperty("browser", "chrome").toLowerCase();
            log.info("Creating {} driver for thread: {}", browser, Thread.currentThread().getName());
            WebDriver driver = createDriver(browser);
            driverThreadLocal.set(driver);
        }
        return driverThreadLocal.get();
    }

    /**
     * Sets a custom WebDriver for the current thread.
     * Useful for injecting mock or remote drivers in tests.
     *
     * @param driver the WebDriver to associate with the current thread
     */
    public static void setDriver(WebDriver driver) {
        log.debug("Setting driver for thread: {}", Thread.currentThread().getName());
        driverThreadLocal.set(driver);
    }

    /**
     * Quits and removes the WebDriver for the current thread.
     * Always call this in @AfterMethod or a finally block.
     */
    public static void quitDriver() {
        WebDriver driver = driverThreadLocal.get();
        if (driver != null) {
            try {
                driver.quit();
                log.info("Driver quit for thread: {}", Thread.currentThread().getName());
            } catch (Exception e) {
                log.warn("Error quitting driver: {}", e.getMessage());
            } finally {
                driverThreadLocal.remove();
            }
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private static WebDriver createDriver(String browser) {
        boolean headless = "true".equalsIgnoreCase(System.getProperty("headless", "false"));

        return switch (browser) {
            case "firefox" -> {
                WebDriverManager.firefoxdriver().setup();
                FirefoxOptions options = new FirefoxOptions();
                if (headless) options.addArguments("-headless");
                FirefoxDriver firefoxDriver = new FirefoxDriver(options);
                configureTimeouts(firefoxDriver);
                yield firefoxDriver;
            }
            case "edge" -> {
                WebDriverManager.edgedriver().setup();
                EdgeOptions options = new EdgeOptions();
                if (headless) options.addArguments("--headless=new");
                EdgeDriver edgeDriver = new EdgeDriver(options);
                configureTimeouts(edgeDriver);
                yield edgeDriver;
            }
            default -> {
                WebDriverManager.chromedriver().setup();
                ChromeOptions options = new ChromeOptions();
                if (headless) options.addArguments("--headless=new");
                options.addArguments("--no-sandbox", "--disable-dev-shm-usage",
                        "--disable-gpu", "--window-size=1920,1080");
                ChromeDriver chromeDriver = new ChromeDriver(options);
                configureTimeouts(chromeDriver);
                yield chromeDriver;
            }
        };
    }

    private static void configureTimeouts(WebDriver driver) {
        driver.manage().window().maximize();
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
        driver.manage().timeouts().pageLoadTimeout(Duration.ofSeconds(30));
        driver.manage().timeouts().scriptTimeout(Duration.ofSeconds(30));
    }
}
