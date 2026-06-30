package com.nat.base;

import com.aventstack.extentreports.ExtentReports;
import com.aventstack.extentreports.ExtentTest;
import com.aventstack.extentreports.reporter.ExtentSparkReporter;
import com.aventstack.extentreports.reporter.configuration.Theme;
import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testng.ITestResult;
import org.testng.annotations.*;

import java.io.File;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Base test class. All test classes extend this.
 * Handles driver lifecycle, screenshot-on-failure, and ExtentReports.
 */
public class BaseTest {

    protected WebDriver driver;
    private static final Logger log = LoggerFactory.getLogger(BaseTest.class);
    private static ExtentReports extent;
    protected static ThreadLocal<ExtentTest> extentTest = new ThreadLocal<>();

    /**
     * Configures the ExtentReports HTML reporter.
     * Called once before any test in a class runs.
     */
    @BeforeClass(alwaysRun = true)
    public void configureReport() {
        String reportPath = "target/reports/extent-report-"
                + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))
                + ".html";
        new File("target/reports").mkdirs();

        ExtentSparkReporter sparkReporter = new ExtentSparkReporter(reportPath);
        sparkReporter.config().setTheme(Theme.DARK);
        sparkReporter.config().setDocumentTitle("NAT2.0 Test Report");
        sparkReporter.config().setReportName("Selenium POM Test Execution");

        extent = new ExtentReports();
        extent.attachReporter(sparkReporter);
        extent.setSystemInfo("Framework", "Selenium + TestNG + POM");
        extent.setSystemInfo("Environment", System.getProperty("env", "staging"));
        log.info("ExtentReports configured at: {}", reportPath);
    }

    /**
     * Initialises ChromeDriver via WebDriverManager before each test method.
     * Configures implicit wait, page load timeout, and window maximise.
     */
    @BeforeMethod(alwaysRun = true)
    public void setUp(java.lang.reflect.Method method) {
        String browser = System.getProperty("browser", "chrome").toLowerCase();
        log.info("Setting up {} driver for test: {}", browser, method.getName());

        WebDriverManager.chromedriver().setup();
        ChromeOptions options = new ChromeOptions();
        if ("true".equals(System.getProperty("headless", "false"))) {
            options.addArguments("--headless=new");
        }
        options.addArguments("--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu");

        driver = new ChromeDriver(options);
        driver.manage().window().maximize();
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
        driver.manage().timeouts().pageLoadTimeout(Duration.ofSeconds(30));
        driver.manage().timeouts().scriptTimeout(Duration.ofSeconds(30));

        extentTest.set(extent.createTest(method.getName()));
        log.info("Driver initialised successfully");
    }

    /**
     * Tears down the driver after each test method.
     * Takes a screenshot on failure and quits the browser.
     *
     * @param result the test result, used to determine pass/fail
     */
    @AfterMethod(alwaysRun = true)
    public void tearDown(ITestResult result) {
        if (result.getStatus() == ITestResult.FAILURE) {
            log.warn("Test FAILED: {} — capturing screenshot", result.getName());
            if (driver != null) {
                BasePage page = new BasePage(driver) {};
                page.takeScreenshot("FAIL_" + result.getName());
            }
            if (extentTest.get() != null) {
                extentTest.get().fail(result.getThrowable());
            }
        } else if (result.getStatus() == ITestResult.SUCCESS) {
            if (extentTest.get() != null) {
                extentTest.get().pass("Test passed");
            }
        } else {
            if (extentTest.get() != null) {
                extentTest.get().skip("Test skipped");
            }
        }

        if (driver != null) {
            driver.quit();
            log.info("Driver quit after test: {}", result.getName());
        }
    }

    /**
     * Flushes the ExtentReports after all tests in the class complete.
     */
    @AfterClass(alwaysRun = true)
    public void flushReport() {
        if (extent != null) {
            extent.flush();
            log.info("ExtentReports flushed");
        }
    }
}
