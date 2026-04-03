import { createSign } from "crypto";

const GOOGLE_SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function normalizePrivateKey(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n").trim() || undefined;
}

async function readGoogleErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    return body.error?.message || JSON.stringify(body);
  } catch {
    return await response.text();
  }
}

async function getGoogleAccessToken(): Promise<string> {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  if (!serviceAccountEmail || !privateKey) {
    throw new Error("Google service account credentials are not configured.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccountEmail,
    scope: GOOGLE_SHEETS_WRITE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header))
    .toString("base64url")
    .replace(/=+$/g, "");
  const encodedClaim = Buffer.from(JSON.stringify(claim))
    .toString("base64url")
    .replace(/=+$/g, "");
  const unsignedToken = `${encodedHeader}.${encodedClaim}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(privateKey, "base64url").replace(/=+$/g, "");
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const errorBody = await readGoogleErrorBody(response);
    throw new Error(`Google auth failed with ${response.status}: ${errorBody}`);
  }

  const body = (await response.json()) as { access_token?: string };

  if (!body.access_token) {
    throw new Error("Google auth response did not include an access token.");
  }

  return body.access_token;
}

async function getWorksheetSheetId(
  spreadsheetId: string,
  worksheetTitle: string,
  accessToken: string
): Promise<number> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await readGoogleErrorBody(response);
    throw new Error(`Failed to load sheet metadata (${response.status}): ${errorBody}`);
  }

  const body = (await response.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };

  const match = (body.sheets ?? []).find(
    (sheet) => sheet.properties?.title === worksheetTitle
  );

  if (!match?.properties?.sheetId && match?.properties?.sheetId !== 0) {
    throw new Error(`Worksheet "${worksheetTitle}" was not found.`);
  }

  return match.properties.sheetId;
}

export async function deleteSourceRowFromGoogleSheet(
  spreadsheetId: string,
  worksheetTitle: string,
  rowNumber: number
): Promise<void> {
  if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new Error("A valid source row number is required.");
  }

  const accessToken = await getGoogleAccessToken();
  const sheetId = await getWorksheetSheetId(spreadsheetId, worksheetTitle, accessToken);

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await readGoogleErrorBody(response);
    throw new Error(`Failed to delete row ${rowNumber} (${response.status}): ${errorBody}`);
  }
}
