# Troubleshooting Guide - Azure App Service

## SSH Connection Closes Immediately

If your SSH connection to Azure App Service closes immediately after "waiting for container to start", the application is likely crashing on startup.

### Common Causes and Solutions

#### 1. Missing Environment Variables

**Symptoms:**
- Container starts but exits immediately
- Log stream shows error messages about missing variables
- SSH connection closes right after container starts

**Solution:**
Check Azure App Service → Configuration → Application settings and ensure all required variables are set:

**Required Environment Variables:**
- `NODE_ENV` = `production`
- `MYSQL_HOST` = Your MySQL server hostname
- `MYSQL_USER` = Your MySQL username
- `MYSQL_PASSWORD` = Your MySQL password
- `MYSQL_DATABASE` = Your MySQL database name
- `PAT_ENCRYPTION_KEY` = A secure encryption key (minimum 32 characters)

**How to Check:**
1. Go to Azure Portal → App Service → Configuration
2. Click on "Application settings" tab
3. Verify all required variables are present
4. Click "Save" if you made changes
5. The app will restart automatically

#### 2. Database Connection Issues

**Symptoms:**
- Errors about MySQL connection failures
- "ECONNREFUSED" or "ETIMEDOUT" errors
- Database authentication errors

**Solution:**
1. Verify MySQL server is running and accessible
2. Check MySQL firewall rules allow connections from Azure App Service
3. Verify credentials are correct
4. Ensure MySQL server allows SSL connections (Azure MySQL requires SSL)

**Check MySQL Firewall:**
- Azure Portal → MySQL Server → Connection security
- Add Azure services to allowed IP addresses
- Or add specific IP ranges for your App Service

#### 3. Application Startup Errors

**Symptoms:**
- Application crashes during startup
- Error messages in log stream
- Container exits with error code

**How to Debug:**
1. Check Log Stream in Azure Portal:
   - App Service → Log stream
   - Look for error messages
   - Check startup logs

2. Check Application Insights (if enabled):
   - App Service → Application Insights
   - View exceptions and errors

3. Use SSH to Debug:
   ```bash
   # Connect via SSH
   az webapp ssh --name devxapi2o --resource-group RG-DevXPlatform
   
   # Once connected, check logs
   cat /home/LogFiles/Application/logging-errors.txt
   
   # Check environment variables
   env | grep -E "NODE_ENV|MYSQL|PAT"
   
   # Try running the app manually
   cd /home/site/wwwroot
   npm start
   ```

#### 4. Port Configuration Issues

**Symptoms:**
- "Port already in use" errors
- Connection refused errors

**Solution:**
- Azure App Service automatically sets PORT environment variable
- Your code should use `process.env.PORT` (defaults to 8080)
- Don't hardcode port numbers

#### 5. Missing Dependencies

**Symptoms:**
- "Module not found" errors
- "Cannot find module" errors

**Solution:**
- Ensure `package.json` and `package-lock.json` are deployed
- Azure automatically runs `npm install --production`
- Check that all required dependencies are in `dependencies` (not `devDependencies`)

### How to View Logs

#### Method 1: Log Stream (Real-time)
1. Azure Portal → App Service → Log stream
2. View real-time application logs
3. Best for debugging startup issues

#### Method 2: Application Logs (Files)
1. Azure Portal → App Service → Logs
2. Enable "Application Logging (Filesystem)"
3. Set Log Level to "Information" or "Error"
4. Save and wait a few minutes
5. View logs in Log stream or download

#### Method 3: SSH Access
```bash
# Connect via Azure CLI
az webapp ssh --name devxapi2o --resource-group RG-DevXPlatform

# Or use Azure Portal
# App Service → SSH → Connect
```

Once connected:
```bash
# View application logs
tail -f /home/LogFiles/Application/logging-errors.txt

# Check startup script
cat /opt/startup/startup.sh

# Check environment variables
env

# Check if app is running
ps aux | grep node

# Check port listening
netstat -tlnp | grep 8080
```

### Debugging Checklist

- [ ] All required environment variables are set in Azure App Service Configuration
- [ ] `NODE_ENV` is set to `production`
- [ ] MySQL connection details are correct
- [ ] MySQL firewall allows connections from Azure
- [ ] PAT_ENCRYPTION_KEY is set (minimum 32 characters)
- [ ] Application logs show specific error messages
- [ ] Node.js version matches (should be 22.x)
- [ ] Build artifacts are correctly deployed (dist/, package.json, package-lock.json)

### Common Error Messages

**"MYSQL_HOST environment variable is required"**
- Solution: Add `MYSQL_HOST` in App Service Configuration

**"PAT_ENCRYPTION_KEY environment variable is required"**
- Solution: Add `PAT_ENCRYPTION_KEY` in App Service Configuration (minimum 32 characters)

**"cross-env: not found"**
- Solution: Already fixed - removed cross-env from start script

**"Port 8080 already in use"**
- Solution: This shouldn't happen - Azure manages the port. Check if multiple instances are running.

**"ECONNREFUSED" (MySQL)**
- Solution: Check MySQL server is running and firewall rules allow Azure connections

**"ETIMEDOUT" (MySQL)**
- Solution: Check network connectivity and MySQL server status

### Getting Help

If you're still experiencing issues:
1. Check the Log Stream for specific error messages
2. Verify all environment variables are set correctly
3. Test database connectivity separately
4. Check Azure Service Health for any ongoing issues
5. Review the deployment logs in Azure DevOps pipeline

