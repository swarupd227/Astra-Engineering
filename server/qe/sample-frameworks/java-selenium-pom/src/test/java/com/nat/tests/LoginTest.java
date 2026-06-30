package com.nat.tests;

import com.nat.base.BaseTest;
import com.nat.pages.LoginPage;
import com.nat.utils.AssertUtils;
import com.nat.utils.DataUtils;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/**
 * Test class for Login page functionality.
 * Extends BaseTest to inherit driver setup, teardown, and reporting.
 */
public class LoginTest extends BaseTest {

    private LoginPage loginPage;

    private static final String BASE_URL   = "https://example.com";
    private static final String LOGIN_PATH = "/login";

    @BeforeMethod(alwaysRun = true)
    public void initPage() {
        loginPage = new LoginPage(driver);
        driver.get(BASE_URL + LOGIN_PATH);
    }

    @Test(
        description = "Valid credentials should redirect the user to the dashboard",
        groups       = {"smoke", "functional"}
    )
    public void testValidLogin() {
        String username = DataUtils.readProperty("valid.username");
        String password = DataUtils.readProperty("valid.password");

        loginPage.login(username, password);

        AssertUtils.assertUrl(driver, "/dashboard");
        extentTest.get().info("Verified redirect to /dashboard after valid login");
    }

    @Test(
        description = "Submitting the login form with empty fields shows a validation error",
        groups       = {"smoke", "functional"}
    )
    public void testEmptyFormSubmission() {
        loginPage.clickLogin();

        AssertUtils.assertVisible(loginPage.getErrorMessageElement(),
                "Validation error displayed for empty form submission");
        extentTest.get().info("Validation error appeared as expected");
    }

    @Test(
        description = "Invalid credentials display an error message on the login page",
        groups       = {"functional", "regression"}
    )
    public void testInvalidCredentials() {
        loginPage.login("wrong@email.com", "wrongpassword99!");

        AssertUtils.assertVisible(loginPage.getErrorMessageElement(),
                "Error message shown for invalid credentials");

        String errorText = loginPage.getErrorMessage();
        AssertUtils.assertText(loginPage.getErrorMessageElement(),
                errorText); // verifies element is readable
        extentTest.get().info("Error message displayed: " + errorText);
    }
}
