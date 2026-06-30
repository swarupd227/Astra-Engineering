# Java + Selenium + TestNG + POM Framework

Production-ready Selenium test automation framework using the Page Object Model pattern.
Built for NAT2.0 autonomous testing.

## Stack
| Component | Version |
|---|---|
| Java | 11+ |
| Selenium WebDriver | 4.18.1 |
| TestNG | 7.9.0 |
| WebDriverManager | 5.7.0 |
| ExtentReports | 5.1.1 |
| Lombok | 1.18.30 |
| Jackson | 2.16.1 |

## Running Tests

### Run all tests
```bash
mvn test
```

### Run a specific group
```bash
mvn test -Dgroups=smoke
mvn test -Dgroups=functional
mvn test -Dgroups=regression
```

### Change browser
```bash
mvn test -Dbrowser=firefox
mvn test -Dbrowser=edge
mvn test -Dbrowser=chrome    # default
```

### Run headless
```bash
mvn test -Dheadless=true
```

## Project Structure
```
src/
  main/java/com/nat/
    base/
      BasePage.java       <- Abstract base for all page objects
      BaseTest.java       <- Abstract base for all test classes
      DriverFactory.java  <- Thread-safe driver management
    utils/
      WaitUtils.java      <- Explicit + fluent wait helpers
      AssertUtils.java    <- Hard + soft assertion wrappers
      DataUtils.java      <- JSON/properties reading, random data
    pages/
      LoginPage.java      <- Example page object
  test/java/com/nat/
    tests/
      LoginTest.java      <- Example test class
  test/resources/
    testng.xml            <- Suite configuration
    config.properties     <- Environment settings
```

## How to Add a New Page Object

1. Create `src/main/java/com/nat/pages/YourPage.java`
2. Extend `BasePage`
3. Add `@FindBy` annotated `WebElement` fields for all locators
4. Call `PageFactory.initElements(driver, this)` in the constructor
5. Write action methods using `fillInput()`, `clickElement()`, `getText()`, `isElementVisible()`

```java
public class YourPage extends BasePage {

    @FindBy(id = "search-input")
    private WebElement searchField;

    @FindBy(css = ".search-button")
    private WebElement searchButton;

    public YourPage(WebDriver driver) {
        super(driver);
        PageFactory.initElements(driver, this);
    }

    public void search(String term) {
        fillInput(searchField, term);
        clickElement(searchButton);
    }
}
```

## How to Add a New Test

1. Create `src/test/java/com/nat/tests/YourTest.java`
2. Extend `BaseTest`
3. Instantiate your page object in `@BeforeMethod`
4. Write `@Test` methods with descriptive `description` and `groups` attributes

```java
public class YourTest extends BaseTest {
    private YourPage yourPage;

    @BeforeMethod
    public void init() {
        yourPage = new YourPage(driver);
        driver.get(BASE_URL + "/your-path");
    }

    @Test(description = "Search returns relevant results", groups = {"smoke"})
    public void testSearch() {
        yourPage.search("test query");
        AssertUtils.assertUrl(driver, "/results");
    }
}
```

## Reports
- HTML report: `target/reports/extent-report-*.html`
- Screenshots on failure: `target/screenshots/`
- TestNG report: `target/surefire-reports/`
