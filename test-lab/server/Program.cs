using System.Text.Json;

const string TestSecret = "00000000000000000000000000000000";
const string Answer1 = "BOMBE_MAL_FLAG_11111111111111111111111111111111";
const string Answer2 = "BOMBE_MAL_FLAG_22222222222222222222222222222222";
const string Answer3 = "BOMBE_MAL_FLAG_33333333333333333333333333333333";

var options = ServerOptions.Parse(args);
var state = new LabState(options.ExpectedEdrAnswer, options.ResultPath);
var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.UseUrls(options.Url);
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "READY" }));
app.MapGet("/status", () => Results.Json(state.Snapshot()));

app.MapPost("/submitMalAns", async (HttpRequest request) =>
{
    JsonElement payload;
    try
    {
        payload = await JsonSerializer.DeserializeAsync<JsonElement>(request.Body);
        if (payload.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("JSON body must be an object");
        }
    }
    catch (JsonException)
    {
        state.RecordAttempt("MAL", "INVALID_PAYLOAD");
        return Results.BadRequest(new { verdict = "INVALID_PAYLOAD" });
    }

    if (!TryString(payload, "secret", out var secret) || secret != TestSecret)
    {
        var verdict = string.IsNullOrEmpty(secret) ? "INVALID_PAYLOAD" : "INVALID_SECRET";
        state.RecordAttempt("MAL", verdict);
        return Results.BadRequest(new { verdict });
    }

    var answers = new[]
    {
        (Key: "mal_answer_1", Field: "answer_1", Expected: Answer1),
        (Key: "mal_answer_2", Field: "answer_2", Expected: Answer2),
        (Key: "mal_answer_3", Field: "answer_3", Expected: Answer3),
    };
    var supplied = answers
        .Select(answer => (answer.Key, answer.Expected, HasValue: TryString(payload, answer.Field, out var value), Value: value))
        .Where(answer => answer.HasValue && !string.IsNullOrWhiteSpace(answer.Value))
        .ToArray();

    if (supplied.Length == 0)
    {
        state.RecordAttempt("MAL", "INVALID_PAYLOAD");
        return Results.BadRequest(new { verdict = "INVALID_PAYLOAD" });
    }

    var stored = state.StoreAnswers("MAL", supplied.Select(answer =>
        (answer.Key, answer.Value!, answer.Expected)));
    state.RecordAttempt("MAL", stored ? "ACCEPTED" : "ALREADY_SUBMITTED");
    return stored
        ? Results.Ok(new { verdict = "ACCEPTED", objectives = state.RoleObjectives("MAL") })
        : Results.Conflict(new { verdict = "ALREADY_SUBMITTED", objectives = state.RoleObjectives("MAL") });
});

app.MapPost("/submitEdrAns", async (HttpRequest request) =>
{
    JsonElement payload;
    try
    {
        payload = await JsonSerializer.DeserializeAsync<JsonElement>(request.Body);
        if (payload.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("JSON body must be an object");
        }
    }
    catch (JsonException)
    {
        state.RecordAttempt("EDR", "INVALID_PAYLOAD");
        return Results.BadRequest(new { verdict = "INVALID_PAYLOAD" });
    }

    if (!TryString(payload, "secret", out var secret) || secret != TestSecret)
    {
        var verdict = string.IsNullOrEmpty(secret) ? "INVALID_PAYLOAD" : "INVALID_SECRET";
        state.RecordAttempt("EDR", verdict);
        return Results.BadRequest(new { verdict });
    }
    if (!TryString(payload, "answer", out var answer) || string.IsNullOrWhiteSpace(answer))
    {
        state.RecordAttempt("EDR", "INVALID_PAYLOAD");
        return Results.BadRequest(new { verdict = "INVALID_PAYLOAD" });
    }

    var stored = state.StoreAnswers("EDR", new[]
    {
        ("edr_detect", answer, options.ExpectedEdrAnswer),
    });
    state.RecordAttempt("EDR", stored ? "ACCEPTED" : "ALREADY_SUBMITTED");
    return stored
        ? Results.Ok(new { verdict = "ACCEPTED", objectives = state.RoleObjectives("EDR") })
        : Results.Conflict(new { verdict = "ALREADY_SUBMITTED", objectives = state.RoleObjectives("EDR") });
});

app.MapPost("/finalize", () => Results.Json(state.Finalize()));

app.Lifetime.ApplicationStopping.Register(state.FinalizeToDisk);
await app.RunAsync();

static bool TryString(JsonElement payload, string field, out string? value)
{
    value = null;
    if (!payload.TryGetProperty(field, out var element) || element.ValueKind != JsonValueKind.String)
    {
        return false;
    }
    value = element.GetString();
    return true;
}

sealed record ServerOptions(string Url, string ExpectedEdrAnswer, string ResultPath)
{
    public static ServerOptions Parse(string[] args)
    {
        string? expectedEdr = null;
        var url = "http://127.0.0.1:5137";
        var result = Path.GetFullPath("result.json");

        for (var index = 0; index < args.Length; index++)
        {
            var value = index + 1 < args.Length ? args[index + 1] : null;
            switch (args[index])
            {
                case "--expected-edr" when value is not null:
                    expectedEdr = value;
                    index++;
                    break;
                case "--url" when value is not null:
                    url = value;
                    index++;
                    break;
                case "--result" when value is not null:
                    result = Path.GetFullPath(value);
                    index++;
                    break;
                default:
                    throw new ArgumentException($"Unknown or incomplete argument: {args[index]}");
            }
        }

        if (string.IsNullOrWhiteSpace(expectedEdr))
        {
            throw new ArgumentException("--expected-edr is required");
        }
        return new ServerOptions(url, expectedEdr, result);
    }
}

sealed class LabState
{
    private readonly object gate = new();
    private readonly string resultPath;
    private readonly DateTimeOffset startedAt = DateTimeOffset.UtcNow;
    private DateTimeOffset? finalizedAt;
    private readonly Dictionary<string, Objective> objectives;
    private readonly List<SubmissionAttempt> submissions = [];

    public LabState(string expectedEdrAnswer, string resultPath)
    {
        this.resultPath = resultPath;
        objectives = new Dictionary<string, Objective>
        {
            ["mal_answer_1"] = new("mal_answer_1", "MAL", "NOT_RECEIVED", null),
            ["mal_answer_2"] = new("mal_answer_2", "MAL", "NOT_RECEIVED", null),
            ["mal_answer_3"] = new("mal_answer_3", "MAL", "NOT_RECEIVED", null),
            ["edr_detect"] = new("edr_detect", "EDR", "NOT_RECEIVED", null),
        };
        ExpectedEdrAnswer = expectedEdrAnswer;
    }

    private string ExpectedEdrAnswer { get; }

    public bool StoreAnswers(string role, IEnumerable<(string Key, string Submitted, string Expected)> answers)
    {
        lock (gate)
        {
            if (finalizedAt is not null)
            {
                return false;
            }
            var stored = false;
            foreach (var answer in answers)
            {
                var current = objectives[answer.Key];
                if (current.Verdict != "NOT_RECEIVED")
                {
                    continue;
                }
                var expected = answer.Key == "edr_detect" ? ExpectedEdrAnswer : answer.Expected;
                objectives[answer.Key] = current with
                {
                    Verdict = string.Equals(answer.Submitted, expected, StringComparison.OrdinalIgnoreCase)
                        ? "PASSED"
                        : "WRONG_ANSWER",
                    Submitted = answer.Submitted,
                };
                stored = true;
            }
            return stored;
        }
    }

    public void RecordAttempt(string role, string verdict)
    {
        lock (gate)
        {
            submissions.Add(new SubmissionAttempt(role, verdict, DateTimeOffset.UtcNow));
        }
    }

    public Objective[] RoleObjectives(string role)
    {
        lock (gate)
        {
            return objectives.Values.Where(value => value.Role == role).ToArray();
        }
    }

    public object Snapshot()
    {
        lock (gate)
        {
            return SnapshotUnsafe();
        }
    }

    public object Finalize()
    {
        lock (gate)
        {
            finalizedAt ??= DateTimeOffset.UtcNow;
            var snapshot = SnapshotUnsafe();
            WriteSnapshot(snapshot);
            return snapshot;
        }
    }

    public void FinalizeToDisk()
    {
        lock (gate)
        {
            finalizedAt ??= DateTimeOffset.UtcNow;
            WriteSnapshot(SnapshotUnsafe());
        }
    }

    private object SnapshotUnsafe() => new
    {
        status = finalizedAt is null ? "RUNNING" : "COMPLETED",
        started_at = startedAt,
        finalized_at = finalizedAt,
        objectives = objectives.Values.OrderBy(value => value.Key).ToArray(),
        submissions = submissions.ToArray(),
    };

    private void WriteSnapshot(object snapshot)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(resultPath) ?? ".");
        File.WriteAllText(resultPath, JsonSerializer.Serialize(snapshot, new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        }));
    }
}

sealed record Objective(string Key, string Role, string Verdict, string? Submitted);
sealed record SubmissionAttempt(string Role, string Verdict, DateTimeOffset ReceivedAt);
