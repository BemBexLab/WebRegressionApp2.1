import bcrypt from "bcryptjs";

function getLoginUser(): string {
  return (process.env.LOGIN_USERNAME ?? process.env.LOGIN_USER ?? "admin").trim();
}

function getConfiguredPassword(): string {
  return process.env.LOGIN_PASSWORD ?? "";
}

async function passwordMatches(inputPassword: string, configuredPassword: string): Promise<boolean> {
  if (!configuredPassword) {
    return false;
  }

  if (configuredPassword.startsWith("$2a$") || configuredPassword.startsWith("$2b$")) {
    return bcrypt.compare(inputPassword, configuredPassword);
  }

  const configuredHash = await bcrypt.hash(configuredPassword, 10);
  return bcrypt.compare(inputPassword, configuredHash);
}

export async function verifyLoginCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const expectedUsername = getLoginUser();
  const expectedPassword = getConfiguredPassword();

  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  if (username.trim() !== expectedUsername) {
    return false;
  }

  return passwordMatches(password, expectedPassword);
}

